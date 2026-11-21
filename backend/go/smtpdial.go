package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/net/idna"
	"golang.org/x/net/proxy"
)

const (
	port25Reason     = "SMTP port 25 unreachable from this server"
	proxyUnreachable = "SMTP proxy unreachable"
	defaultMailFrom  = "verifier@example.com"
	defaultHeloHost  = "example.com"
	defaultProbeHost = "aspmx.l.google.com"
)

type smtpSettings struct {
	Port           int
	ProxyURL       string
	HeloHost       string
	MailFrom       string
	ConnectTimeout time.Duration
	SessionTimeout time.Duration
}

func smtpSettingsFromRequest(r *http.Request) smtpSettings {
	proxyURL := strings.TrimSpace(os.Getenv("SMTP_PROXY"))
	helo := firstNonEmpty(os.Getenv("SMTP_HELO_HOST"), os.Getenv("SMTP_HELO_NAME"))
	mailFrom := firstNonEmpty(os.Getenv("SMTP_MAIL_FROM"), defaultMailFrom)

	if r != nil {
		if r.Header.Get("X-Mailforge-Smtp-Override") == "1" {
			proxyURL = strings.TrimSpace(r.Header.Get("X-Mailforge-Smtp-Proxy"))
		} else if v := strings.TrimSpace(r.Header.Get("X-Mailforge-Smtp-Proxy")); v != "" {
			proxyURL = v
		}
		if v := strings.TrimSpace(r.Header.Get("X-Mailforge-Helo-Host")); v != "" {
			helo = v
		}
		if v := strings.TrimSpace(r.Header.Get("X-Mailforge-Mail-From")); v != "" {
			mailFrom = v
		}
	}

	mailFrom = sanitizeMailFrom(mailFrom)
	return smtpSettings{
		Port:           configuredSmtpPort(),
		ProxyURL:       proxyURL,
		HeloHost:       sanitizeHelo(helo, mailFrom),
		MailFrom:       mailFrom,
		ConnectTimeout: 8 * time.Second,
		SessionTimeout: 12 * time.Second,
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func sanitizeMailFrom(v string) string {
	v = strings.TrimSpace(v)
	if v == "" || strings.ContainsAny(v, " \r\n\t") || !strings.Contains(v, "@") {
		return defaultMailFrom
	}
	return v
}

func sanitizeHelo(helo, mailFrom string) string {
	helo = strings.TrimSpace(helo)
	if helo == "" || strings.ContainsAny(helo, " \r\n\t") {
		if at := strings.LastIndex(mailFrom, "@"); at >= 0 && at < len(mailFrom)-1 {
			helo = mailFrom[at+1:]
		}
	}
	helo = strings.TrimSpace(helo)
	if helo == "" || strings.ContainsAny(helo, " \r\n\t") {
		return defaultHeloHost
	}
	return helo
}

func asciiDomain(domain string) string {
	domain = strings.TrimSuffix(strings.TrimSpace(domain), ".")
	if domain == "" {
		return domain
	}
	ascii, err := idna.Lookup.ToASCII(domain)
	if err != nil || ascii == "" {
		return domain
	}
	return ascii
}

func randomProbe(domain string) string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("mf-%d@%s", time.Now().UnixNano(), domain)
	}
	return "mf-" + hex.EncodeToString(buf) + "@" + domain
}

func dialSMTP(addr, proxyURL string, timeout time.Duration) (net.Conn, error) {
	if timeout <= 0 {
		timeout = 8 * time.Second
	}
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL == "" {
		return net.DialTimeout("tcp", addr, timeout)
	}

	u, err := url.Parse(proxyURL)
	if err != nil || u.Host == "" || (u.Scheme != "socks5" && u.Scheme != "socks5h" && u.Scheme != "socks4" && u.Scheme != "socks4a") {
		return nil, fmt.Errorf("invalid SMTP proxy URL")
	}
	if u.Scheme == "socks5h" {
		u.Scheme = "socks5"
	}

	base := &net.Dialer{Timeout: timeout}
	dialer, err := proxy.FromURL(u, base)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", proxyUnreachable, err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if cd, ok := dialer.(proxy.ContextDialer); ok {
		conn, dialErr := cd.DialContext(ctx, "tcp", addr)
		if dialErr != nil {
			return nil, dialErr
		}
		return conn, nil
	}
	return dialer.Dial("tcp", addr)
}

func connReason(proxyURL string, err error) string {
	if err == nil {
		return port25Reason
	}
	msg := err.Error()
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "invalid smtp proxy") {
		return "invalid SMTP proxy URL"
	}
	if strings.TrimSpace(proxyURL) != "" && proxyDialFailed(proxyURL, lower) {
		return proxyUnreachable + ": " + msg
	}
	if strings.Contains(lower, strings.ToLower(port25Reason)) {
		return msg
	}
	return port25Reason + ": " + msg
}

// proxyDialFailed is true when the TCP connection to the proxy itself failed.
// A timeout reaching the destination :25 through a live proxy is not a proxy failure.
func proxyDialFailed(proxyURL, lower string) bool {
	parsed, err := url.Parse(strings.TrimSpace(proxyURL))
	if err != nil || parsed.Hostname() == "" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	refused := strings.Contains(lower, "connection refused") ||
		strings.Contains(lower, "no such host") ||
		strings.Contains(lower, "network is unreachable")
	return refused && strings.Contains(lower, "dial tcp "+host)
}

func isTimeoutErr(err error) bool {
	if err == nil {
		return false
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "i/o timeout") || strings.Contains(lower, "timed out") || strings.Contains(lower, "timeout")
}
