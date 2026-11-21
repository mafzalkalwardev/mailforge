package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/idna"
	"golang.org/x/net/proxy"
)

var (
	mailboxPattern = regexp.MustCompile(`(?i)5\.1\.[0-3]|user unknown|unknown user|no such user|user not found|recipient unknown|mailbox unavailable|mailbox not found|mailbox does not exist|no such mailbox|invalid recipient|recipient invalid|invalid mailbox|account disabled|account does not exist|does not exist|no mailbox`)
	strongMailbox  = regexp.MustCompile(`(?i)5\.1\.[0-3]|user unknown|unknown user|no such user|user not found|mailbox unavailable|mailbox not found|no such mailbox|does not exist|no mailbox`)
	strongPolicy   = regexp.MustCompile(`(?i)no smtp service|dns ptr|invalid dns ptr|ptr resource|\brdns\b|spamhaus|\bpbl\b`)
	policyPattern  = regexp.MustCompile(`(?i)client host|access denied|service unavailable|blacklist|blacklisted|blocked|not permitted|relay access denied|greylist|grey-?list|try again|poor reputation|sender address rejected|dnsbl|administrative prohibition|\b421\b|\b4\.7\.|\b5\.7\.`)
	dialPattern    = regexp.MustCompile(`(?i)i/o timeout|dial tcp|connection refused|connection reset|network is unreachable|no route to host|verification proxy offline|smtp port 25 unreachable|context deadline exceeded|wsarecv|proxy offline|no such host|dialog timed out`)
	tempCode       = regexp.MustCompile(`(?i)\b(421|450|451|452|554)\b`)
	acceptPattern  = regexp.MustCompile(`(?i)\b250\b|\b2\.1\.5\b`)
)

type smtpOpts struct {
	Proxy          string
	Helo           string
	From           string
	Port           int
	DialTimeout    time.Duration
	SessionTimeout time.Duration
}

type mailboxResult struct {
	Host            string
	Response        string
	MailboxVerified string
	Valid           bool
	CatchAll        bool
	Ran             bool
	Passed          bool
	Summary         string
	CheckMessage    string
}

type smtpClass struct {
	Kind   string
	Reason string
}

type sessionOutcome struct {
	code       int
	text       string
	stage      string
	err        error
	dialFailed bool
}

func envFrom() string {
	if v := strings.TrimSpace(os.Getenv("SMTP_FROM")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("VERIFIER_EMAIL")); v != "" {
		return v
	}
	return "verifier@example.com"
}

func envHelo(from string) string {
	if v := strings.TrimSpace(os.Getenv("SMTP_HELO")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("SMTP_EHLO")); v != "" {
		return v
	}
	if at := strings.LastIndex(from, "@"); at > 0 && at < len(from)-1 {
		return from[at+1:]
	}
	return "localhost"
}

func envProxy() string {
	return strings.TrimSpace(os.Getenv("SMTP_PROXY"))
}

func normalizeOpts(opts smtpOpts) smtpOpts {
	if strings.TrimSpace(opts.From) == "" {
		opts.From = envFrom()
	}
	if strings.TrimSpace(opts.Helo) == "" {
		opts.Helo = envHelo(opts.From)
	}
	if opts.Port <= 0 {
		opts.Port = configuredSmtpPort()
	}
	if opts.DialTimeout <= 0 {
		opts.DialTimeout = 10 * time.Second
	}
	if opts.SessionTimeout <= 0 {
		opts.SessionTimeout = 15 * time.Second
	}
	opts.From = safeToken(opts.From)
	opts.Helo = safeToken(opts.Helo)
	opts.Proxy = strings.TrimSpace(opts.Proxy)
	return opts
}

func safeToken(value string) string {
	return strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' || r == ' ' || r == '\t' {
			return -1
		}
		return r
	}, strings.TrimSpace(value))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func classifySMTPText(text string) smtpClass {
	lower := strings.ToLower(text)
	if dialPattern.MatchString(lower) {
		if strings.Contains(lower, "verification proxy offline") || strings.Contains(lower, "proxy offline") ||
			(strings.Contains(lower, "proxy") && (strings.Contains(lower, "refused") || strings.Contains(lower, "offline"))) {
			return smtpClass{Kind: "unknown", Reason: "verification proxy offline"}
		}
		if strings.Contains(lower, "dialog timed out") {
			return smtpClass{Kind: "unknown", Reason: "SMTP dialog timed out before a mailbox reply"}
		}
		return smtpClass{Kind: "unknown", Reason: "SMTP port 25 unreachable from this server"}
	}
	if strongPolicy.MatchString(lower) {
		return smtpClass{Kind: "unknown", Reason: "policy rejection, not a mailbox result"}
	}
	mailbox := mailboxPattern.MatchString(lower)
	policy := policyPattern.MatchString(lower)
	if mailbox && (!policy || strongMailbox.MatchString(lower)) {
		return smtpClass{Kind: "invalid", Reason: "mailbox rejected"}
	}
	if policy || tempCode.MatchString(lower) {
		return smtpClass{Kind: "unknown", Reason: "policy rejection, not a mailbox result"}
	}
	if mailbox {
		return smtpClass{Kind: "invalid", Reason: "mailbox rejected"}
	}
	if acceptPattern.MatchString(lower) {
		return smtpClass{Kind: "accepted", Reason: "accepted"}
	}
	if regexp.MustCompile(`(?i)(^|\s)550\b`).MatchString(lower) {
		return smtpClass{Kind: "invalid", Reason: "mailbox rejected"}
	}
	if strings.TrimSpace(text) == "" {
		return smtpClass{Kind: "unknown", Reason: "no SMTP reply"}
	}
	return smtpClass{Kind: "unknown", Reason: "could not verify"}
}

func classifyReply(code int, text string) smtpClass {
	if code >= 200 && code < 300 {
		class := classifySMTPText(text)
		if class.Kind == "invalid" || (class.Kind == "unknown" && class.Reason == "policy rejection, not a mailbox result") {
			return class
		}
		if dialPattern.MatchString(strings.ToLower(text)) {
			return class
		}
		return smtpClass{Kind: "accepted", Reason: "accepted"}
	}
	if strings.TrimSpace(text) == "" {
		text = strconv.Itoa(code)
	}
	if code == 550 && !policyPattern.MatchString(strings.ToLower(text)) && !strongPolicy.MatchString(strings.ToLower(text)) {
		class := classifySMTPText(text)
		if class.Kind == "unknown" && !dialPattern.MatchString(strings.ToLower(text)) {
			return smtpClass{Kind: "invalid", Reason: "mailbox rejected"}
		}
		return class
	}
	return classifySMTPText(text)
}

func asciiHost(host string) string {
	host = strings.TrimSuffix(strings.TrimSpace(host), ".")
	if host == "" {
		return host
	}
	if converted, err := idna.Lookup.ToASCII(host); err == nil && converted != "" {
		return converted
	}
	return host
}

func dialTarget(ctx context.Context, addr, proxyURI string) (net.Conn, error) {
	if strings.TrimSpace(proxyURI) == "" {
		return (&net.Dialer{}).DialContext(ctx, "tcp", addr)
	}
	parsed, err := url.Parse(proxyURI)
	if err != nil || parsed.Host == "" || !supportedProxy(parsed.Scheme) {
		return nil, fmt.Errorf("verification proxy offline: invalid SMTP proxy URL")
	}
	probe, err := (&net.Dialer{}).DialContext(ctx, "tcp", parsed.Host)
	if err != nil {
		return nil, fmt.Errorf("verification proxy offline: %w", err)
	}
	_ = probe.Close()

	socks, err := proxy.FromURL(parsed, &net.Dialer{})
	if err != nil {
		return nil, fmt.Errorf("verification proxy offline: %w", err)
	}
	var conn net.Conn
	if contextDialer, ok := socks.(proxy.ContextDialer); ok {
		conn, err = contextDialer.DialContext(ctx, "tcp", addr)
	} else {
		conn, err = socks.Dial("tcp", addr)
	}
	if err != nil {
		if strings.Contains(err.Error(), parsed.Host) && !strings.Contains(err.Error(), addr) {
			return nil, fmt.Errorf("verification proxy offline: %w", err)
		}
		return nil, err
	}
	return conn, nil
}

func supportedProxy(scheme string) bool {
	switch strings.ToLower(scheme) {
	case "socks5", "socks5h", "socks4", "socks4a":
		return true
	default:
		return false
	}
}

func runSession(conn net.Conn, helo, from, rcpt string) sessionOutcome {
	reader := bufio.NewReader(conn)
	writer := bufio.NewWriter(conn)
	code, text, err := readSMTP(reader)
	if err != nil {
		return sessionOutcome{stage: "banner", code: code, text: text, err: err}
	}
	if code != 220 {
		return sessionOutcome{stage: "banner", code: code, text: text}
	}
	if err = writeSMTP(writer, "EHLO "+helo); err != nil {
		return sessionOutcome{stage: "ehlo", err: err}
	}
	code, text, err = readSMTP(reader)
	if err != nil || code >= 400 {
		_ = writeSMTP(writer, "HELO "+helo)
		code, text, err = readSMTP(reader)
		if err != nil || code >= 400 {
			return sessionOutcome{stage: "ehlo", code: code, text: text, err: err}
		}
	}
	if err = writeSMTP(writer, "MAIL FROM:<"+from+">"); err != nil {
		return sessionOutcome{stage: "mail", err: err}
	}
	code, text, err = readSMTP(reader)
	if err != nil || code >= 400 {
		return sessionOutcome{stage: "mail", code: code, text: text, err: err}
	}
	if err = writeSMTP(writer, "RCPT TO:<"+rcpt+">"); err != nil {
		return sessionOutcome{stage: "rcpt", err: err}
	}
	code, text, err = readSMTP(reader)
	return sessionOutcome{stage: "rcpt", code: code, text: text, err: err}
}

func readSMTP(reader *bufio.Reader) (int, string, error) {
	var lines []string
	code := 0
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return code, strings.Join(lines, " | "), err
		}
		line = strings.TrimRight(line, "\r\n")
		if len(line) < 3 {
			return 0, line, fmt.Errorf("short smtp response")
		}
		parsed, convErr := strconv.Atoi(line[:3])
		if convErr != nil {
			return 0, line, fmt.Errorf("bad smtp response")
		}
		code = parsed
		lines = append(lines, line)
		if len(line) == 3 || line[3] != '-' {
			return code, strings.Join(lines, " | "), nil
		}
	}
}

func writeSMTP(writer *bufio.Writer, command string) error {
	if _, err := writer.WriteString(command + "\r\n"); err != nil {
		return err
	}
	return writer.Flush()
}

func dialAndSession(host, rcpt string, opts smtpOpts) sessionOutcome {
	opts = normalizeOpts(opts)
	addr := net.JoinHostPort(asciiHost(host), strconv.Itoa(opts.Port))
	ctx, cancel := context.WithTimeout(context.Background(), opts.DialTimeout)
	defer cancel()
	conn, err := dialTarget(ctx, addr, opts.Proxy)
	if err != nil {
		return sessionOutcome{stage: "dial", err: err, dialFailed: true, text: err.Error()}
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(opts.SessionTimeout))
	return runSession(conn, opts.Helo, opts.From, rcpt)
}

func previewSMTP(text string) string {
	one := strings.Join(strings.Fields(text), " ")
	if len(one) > 180 {
		return one[:180] + "…"
	}
	return one
}

func failureResult(host string, err error) mailboxResult {
	message := ""
	if err != nil {
		message = err.Error()
	}
	class := classifySMTPText(message)
	response := message
	if class.Reason == "verification proxy offline" {
		response = "verification proxy offline"
	} else if class.Reason == "SMTP port 25 unreachable from this server" {
		response = "SMTP port 25 unreachable from this server: " + message
	} else if strings.TrimSpace(class.Reason) != "" {
		response = class.Reason
	}
	return mailboxResult{
		Host:            host,
		Response:        response,
		MailboxVerified: "unknown",
		Valid:           false,
		Ran:             true,
		Summary:         class.Reason,
		CheckMessage:    class.Reason,
	}
}

func replyResult(host, email, text string, class smtpClass) mailboxResult {
	switch class.Kind {
	case "invalid":
		return mailboxResult{
			Host:            host,
			Response:        text,
			MailboxVerified: "no",
			Valid:           false,
			Ran:             true,
			Summary:         email + " seems not to be valid",
			CheckMessage:    "Dialog with " + host,
		}
	case "accepted":
		return mailboxResult{
			Host:            host,
			Response:        text,
			MailboxVerified: "yes",
			Valid:           true,
			Ran:             true,
			Passed:          true,
			Summary:         email + " seems to be valid",
			CheckMessage:    "Dialog with " + host + " succeeded",
		}
	default:
		reason := class.Reason
		if reason == "" {
			reason = "could not verify"
		}
		summary := email + " — " + reason
		if reason == "policy rejection, not a mailbox result" {
			summary = email + " — could not verify (policy rejection, not a mailbox result): " + previewSMTP(text)
		}
		return mailboxResult{
			Host:            host,
			Response:        text,
			MailboxVerified: "unknown",
			Valid:           false,
			Ran:             true,
			Summary:         summary,
			CheckMessage:    "Dialog with " + host + " (" + reason + ")",
		}
	}
}

func probeAddress(domain string) string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return "mfprobe-fallback@" + domain
	}
	return "mfprobe-" + hex.EncodeToString(buf) + "@" + domain
}

func checkMailbox(email string, hosts []mxRecord, opts smtpOpts) mailboxResult {
	opts = normalizeOpts(opts)
	domain := domainOf(email)
	var last mailboxResult
	tried := 0
	for _, mx := range hosts {
		host := asciiHost(mx.Host)
		if host == "" || host == "." {
			continue
		}
		if tried >= 3 {
			break
		}
		tried++
		session := dialAndSession(host, email, opts)
		if session.dialFailed {
			last = failureResult(host, session.err)
			if strings.Contains(strings.ToLower(session.text), "verification proxy offline") {
				return last
			}
			continue
		}
		if session.err != nil && strings.TrimSpace(session.text) == "" {
			last = failureResult(host, session.err)
			continue
		}
		class := classifyReply(session.code, session.text)
		if session.stage != "rcpt" {
			last = replyResult(host, email, session.text, smtpClass{Kind: "unknown", Reason: class.Reason})
			if class.Kind == "unknown" && (class.Reason == "policy rejection, not a mailbox result" || session.code >= 400) {
				if last.Summary == "" || !strings.Contains(last.Summary, "policy") {
					last = replyResult(host, email, session.text, smtpClass{Kind: "unknown", Reason: "policy rejection, not a mailbox result"})
				}
				return last
			}
			continue
		}
		if class.Kind != "accepted" {
			return replyResult(host, email, session.text, class)
		}

		probe := dialAndSession(host, probeAddress(domain), opts)
		if probe.dialFailed || (probe.err != nil && strings.TrimSpace(probe.text) == "") || probe.stage != "rcpt" {
			return mailboxResult{
				Host:            host,
				Response:        session.text,
				MailboxVerified: "unknown",
				Valid:           false,
				Ran:             true,
				Summary:         email + " — could not verify (catch-all probe did not finish)",
				CheckMessage:    "RCPT TO was accepted but the catch-all probe did not finish",
			}
		}
		probeClass := classifyReply(probe.code, probe.text)
		if probeClass.Kind == "accepted" {
			return mailboxResult{
				Host:            host,
				Response:        session.text,
				MailboxVerified: "catch_all",
				Valid:           false,
				CatchAll:        true,
				Ran:             true,
				Summary:         email + " — domain accepts all recipients (catch-all / risky)",
				CheckMessage:    "Domain accepts all recipients (catch-all)",
			}
		}
		if probeClass.Kind == "invalid" {
			return replyResult(host, email, session.text, smtpClass{Kind: "accepted", Reason: "accepted"})
		}
		return mailboxResult{
			Host:            host,
			Response:        session.text,
			MailboxVerified: "unknown",
			Valid:           false,
			Ran:             true,
			Summary:         email + " — could not verify (catch-all probe did not finish): " + previewSMTP(probe.text),
			CheckMessage:    "RCPT TO was accepted but the catch-all probe was inconclusive",
		}
	}
	if tried == 0 {
		return mailboxResult{MailboxVerified: "no", Valid: false, Summary: email + " seems not to be valid", CheckMessage: "No MX records found for domain"}
	}
	if last.Response == "" && last.Summary == "" {
		return failureResult("", fmt.Errorf("dial tcp :%d: i/o timeout", opts.Port))
	}
	return last
}

func domainOf(email string) string {
	if at := strings.LastIndex(email, "@"); at >= 0 && at < len(email)-1 {
		return email[at+1:]
	}
	return ""
}

var (
	probeMu    sync.Mutex
	probeCache map[string]interface{}
	probeAt    time.Time
)

func probeTargetHost() string {
	if host := strings.TrimSpace(os.Getenv("SMTP_PROBE_HOST")); host != "" {
		return host
	}
	return "gmail-smtp-in.l.google.com"
}

func redactProxy(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return ""
	}
	return parsed.Host
}

func runSMTPProbe() map[string]interface{} {
	proxyURI := envProxy()
	port := configuredSmtpPort()
	host := probeTargetHost()
	result := map[string]interface{}{
		"proxy_configured": proxyURI != "",
		"proxy_reachable":  nil,
		"proxy_endpoint":   redactProxy(proxyURI),
		"port25_ok":        false,
		"via":              "direct",
		"detail":           "",
		"probe_host":       net.JoinHostPort(host, strconv.Itoa(port)),
		"degraded":         true,
	}
	if proxyURI != "" {
		result["via"] = "proxy"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := dialTarget(ctx, net.JoinHostPort(asciiHost(host), strconv.Itoa(port)), proxyURI)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "verification proxy offline") {
			result["proxy_reachable"] = false
			result["detail"] = "verification proxy offline"
			return result
		}
		if proxyURI != "" {
			result["proxy_reachable"] = true
		}
		result["detail"] = "SMTP port 25 unreachable from this server"
		return result
	}
	_ = conn.Close()
	if proxyURI != "" {
		result["proxy_reachable"] = true
	}
	result["port25_ok"] = true
	result["degraded"] = false
	result["detail"] = ""
	return result
}

func currentSMTPProbe(force bool) map[string]interface{} {
	probeMu.Lock()
	defer probeMu.Unlock()
	if !force && probeCache != nil && time.Since(probeAt) < 30*time.Second {
		return probeCache
	}
	probeCache = runSMTPProbe()
	probeAt = time.Now()
	return probeCache
}
