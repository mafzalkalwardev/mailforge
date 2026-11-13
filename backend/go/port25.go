package main

import (
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type port25Report struct {
	Reachable       bool   `json:"reachable"`
	DirectReachable bool   `json:"direct_reachable"`
	ProxyConfigured bool   `json:"proxy_configured"`
	ProxyReachable  bool   `json:"proxy_reachable"`
	Via             string `json:"via"`
	Detail          string `json:"detail"`
	CheckedAt       string `json:"checked_at,omitempty"`
	Pending         bool   `json:"pending,omitempty"`
}

type port25Entry struct {
	at     time.Time
	report port25Report
}

var (
	port25Mu    sync.Mutex
	port25Cache = map[string]port25Entry{}
)

func port25CacheKey(proxyURL string) string {
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL == "" {
		return "direct"
	}
	// Do not keep the raw proxy URL (it may contain a password) as a map key in logs.
	return "proxy:" + proxyURL
}

func currentPort25() port25Report {
	proxyURL := strings.TrimSpace(os.Getenv("SMTP_PROXY"))
	if report, ok := cachedPort25(proxyURL, 2*time.Minute); ok {
		return report
	}
	return port25Report{
		Pending:         true,
		ProxyConfigured: proxyURL != "",
		Via:             viaLabel(proxyURL),
		Detail:          "SMTP port 25 check is still running",
	}
}

func cachedPort25(proxyURL string, maxAge time.Duration) (port25Report, bool) {
	port25Mu.Lock()
	defer port25Mu.Unlock()
	entry, ok := port25Cache[port25CacheKey(proxyURL)]
	if !ok || time.Since(entry.at) > maxAge {
		return port25Report{}, false
	}
	return entry.report, true
}

func port25ForProxy(proxyURL string) port25Report {
	proxyURL = strings.TrimSpace(proxyURL)
	if report, ok := cachedPort25(proxyURL, time.Minute); ok && !report.Pending {
		return report
	}
	report := runPort25Check(proxyURL)
	port25Mu.Lock()
	port25Cache[port25CacheKey(proxyURL)] = port25Entry{at: time.Now(), report: report}
	port25Mu.Unlock()
	return report
}

func warmPort25() {
	_ = port25ForProxy(os.Getenv("SMTP_PROXY"))
}

func viaLabel(proxyURL string) string {
	if strings.TrimSpace(proxyURL) == "" {
		return "direct"
	}
	return "proxy"
}

func probeAddr() string {
	host := strings.TrimSpace(os.Getenv("SMTP_PROBE_HOST"))
	if host == "" {
		host = defaultProbeHost
	}
	port := configuredSmtpPort()
	if port <= 0 {
		port = 25
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

func runPort25Check(proxyURL string) port25Report {
	proxyURL = strings.TrimSpace(proxyURL)
	addr := probeAddr()
	timeout := 5 * time.Second

	type result struct {
		ok     bool
		detail string
	}
	directCh := make(chan result, 1)
	go func() {
		ok, detail := probeBanner(addr, "", timeout)
		directCh <- result{ok, detail}
	}()

	var proxyResult *result
	if proxyURL != "" {
		ch := make(chan result, 1)
		go func() {
			ok, detail := probeBanner(addr, proxyURL, timeout)
			ch <- result{ok, detail}
		}()
		r := <-ch
		proxyResult = &r
	}
	direct := <-directCh

	report := port25Report{
		DirectReachable: direct.ok,
		ProxyConfigured: proxyURL != "",
		Via:             "direct",
		CheckedAt:       time.Now().UTC().Format(time.RFC3339),
	}
	if proxyResult != nil {
		report.Via = "proxy"
		report.ProxyReachable = proxyResult.ok
		report.Reachable = proxyResult.ok
	} else {
		report.Reachable = direct.ok
	}

	switch {
	case report.Reachable && report.Via == "proxy" && !direct.ok:
		report.Detail = "Direct port 25 is blocked; SMTP proxy can reach port 25"
	case report.Reachable && report.Via == "proxy":
		report.Detail = "Outbound SMTP port 25 is reachable through the configured proxy"
	case report.Reachable:
		report.Detail = "Outbound SMTP port 25 is reachable"
	case report.Via == "proxy":
		report.Detail = proxyResult.detail
	default:
		report.Detail = direct.detail
	}
	if !report.Reachable && !strings.Contains(report.Detail, port25Reason) && !strings.Contains(strings.ToLower(report.Detail), "proxy") {
		report.Detail = port25Reason + ": " + report.Detail
	}
	return report
}

func probeBanner(addr, proxyURL string, timeout time.Duration) (bool, string) {
	conn, err := dialSMTP(addr, proxyURL, timeout)
	if err != nil {
		return false, connReason(proxyURL, err)
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	buf := make([]byte, 256)
	n, readErr := conn.Read(buf)
	if n > 0 {
		line := strings.TrimSpace(string(buf[:n]))
		if len(line) >= 3 && line[0] >= '2' && line[0] <= '5' && line[1] >= '0' && line[1] <= '9' {
			return true, line
		}
	}
	if readErr != nil {
		return false, connReason(proxyURL, readErr)
	}
	return false, port25Reason
}
