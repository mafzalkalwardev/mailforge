package main

import (
	"bufio"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestConnReasonDistinguishesProxyDownFromPort25(t *testing.T) {
	proxyURL := "socks5://127.0.0.1:1080"
	down := errors.New("socks connect tcp 127.0.0.1:1080->mx.web.de:25: dial tcp 127.0.0.1:1080: connect: connection refused")
	if !strings.Contains(connReason(proxyURL, down), proxyUnreachable) {
		t.Fatalf("down proxy: %s", connReason(proxyURL, down))
	}
	blocked := errors.New("socks connect tcp 127.0.0.1:1080->mx.web.de:25: dial tcp 212.227.17.12:25: i/o timeout")
	got := connReason(proxyURL, blocked)
	if !strings.Contains(got, port25Reason) || strings.Contains(got, proxyUnreachable) {
		t.Fatalf("blocked port 25 via proxy: %s", got)
	}
	direct := errors.New("dial tcp 212.227.17.12:25: i/o timeout")
	if !strings.Contains(connReason("", direct), port25Reason) {
		t.Fatalf("direct timeout: %s", connReason("", direct))
	}
}

func TestSMTPSettingsFromEnvAndOverride(t *testing.T) {
	t.Setenv("SMTP_PROXY", "socks5://env-user:secret@127.0.0.1:1080")
	t.Setenv("SMTP_HELO_HOST", "mail.example.com")
	t.Setenv("SMTP_MAIL_FROM", "verify@example.com")

	fromEnv := smtpSettingsFromRequest(nil)
	if fromEnv.ProxyURL != "socks5://env-user:secret@127.0.0.1:1080" {
		t.Fatalf("env proxy = %q", fromEnv.ProxyURL)
	}
	if fromEnv.HeloHost != "mail.example.com" || fromEnv.MailFrom != "verify@example.com" {
		t.Fatalf("helo/mailfrom = %s %s", fromEnv.HeloHost, fromEnv.MailFrom)
	}

	req, err := http.NewRequest(http.MethodGet, "http://verifier/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-Mailforge-Smtp-Override", "1")
	req.Header.Set("X-Mailforge-Helo-Host", "ehlo.example.net")
	req.Header.Set("X-Mailforge-Mail-From", "probe@example.net")
	cleared := smtpSettingsFromRequest(req)
	if cleared.ProxyURL != "" {
		t.Fatalf("override should clear proxy, got %q", cleared.ProxyURL)
	}
	if cleared.HeloHost != "ehlo.example.net" || cleared.MailFrom != "probe@example.net" {
		t.Fatalf("header helo/mailfrom = %s %s", cleared.HeloHost, cleared.MailFrom)
	}
}

func TestConnectionTimeoutIsUnknown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			time.Sleep(2 * time.Second)
			conn.Close()
		}
	}()
	host, port := splitHostPort(t, ln.Addr().String())
	verdict := verifyMailbox("person@example.com", "example.com", []string{host}, smtpSettings{
		Port:           port,
		HeloHost:       "example.com",
		MailFrom:       "verifier@example.com",
		ConnectTimeout: 300 * time.Millisecond,
		SessionTimeout: 300 * time.Millisecond,
	})
	if verdict.Valid {
		t.Fatalf("timeout must not be valid: %+v", verdict)
	}
	if verdict.MailboxVerified != "unknown" {
		t.Fatalf("mailbox = %s", verdict.MailboxVerified)
	}
	if !strings.Contains(verdict.Response, port25Reason) {
		t.Fatalf("response = %q", verdict.Response)
	}
	if strings.Contains(verdict.CheckDetail, "250 OK") {
		t.Fatalf("timeout was reported as 250 OK: %s", verdict.CheckDetail)
	}
}

func TestRcpt550IsInvalid(t *testing.T) {
	host, port := startScriptedSMTP(t, func(line string) string {
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(line)), "RCPT") {
			return "550 5.1.1 User unknown"
		}
		return "250 ok"
	})
	verdict := verifyOn(t, host, port, "missing@example.com")
	if verdict.Valid || verdict.CatchAll {
		t.Fatalf("550 must be invalid: %+v", verdict)
	}
	if verdict.MailboxVerified != "no" {
		t.Fatalf("mailbox = %s", verdict.MailboxVerified)
	}
	if !strings.Contains(verdict.Response, "550") {
		t.Fatalf("response = %q", verdict.Response)
	}
}

func TestRcpt250IsValid(t *testing.T) {
	host, port := startScriptedSMTP(t, func(line string) string {
		upper := strings.ToUpper(line)
		if strings.Contains(upper, "RCPT") && strings.Contains(strings.ToLower(line), "mf-") {
			return "550 5.1.1 User unknown"
		}
		if strings.Contains(upper, "RCPT") {
			return "250 2.1.5 OK"
		}
		return "250 ok"
	})
	verdict := verifyOn(t, host, port, "real.user@example.com")
	if !verdict.Valid || verdict.CatchAll {
		t.Fatalf("accepted RCPT must be valid: %+v", verdict)
	}
	if verdict.MailboxVerified != "yes" {
		t.Fatalf("mailbox = %s", verdict.MailboxVerified)
	}
	if !strings.Contains(verdict.Response, "250") {
		t.Fatalf("response = %q", verdict.Response)
	}
}

func TestCatchAllIsRisky(t *testing.T) {
	host, port := startScriptedSMTP(t, func(line string) string {
		return "250 2.1.5 OK"
	})
	verdict := verifyOn(t, host, port, "anyone@example.com")
	if verdict.Valid {
		t.Fatalf("catch-all must not be valid: %+v", verdict)
	}
	if !verdict.CatchAll || verdict.MailboxVerified != "catch_all" {
		t.Fatalf("mailbox = %s catch_all=%v", verdict.MailboxVerified, verdict.CatchAll)
	}
	if !strings.Contains(strings.ToLower(verdict.Summary), "catch-all") {
		t.Fatalf("summary = %q", verdict.Summary)
	}
}

func TestGreylistIsUnknown(t *testing.T) {
	host, port := startScriptedSMTP(t, func(line string) string {
		upper := strings.ToUpper(line)
		if strings.Contains(upper, "RCPT") && strings.Contains(strings.ToLower(line), "mf-") {
			return "550 5.1.1 User unknown"
		}
		if strings.Contains(upper, "RCPT") {
			return "451 4.7.1 Greylisted, try again later"
		}
		return "250 ok"
	})
	verdict := verifyOn(t, host, port, "real.user@example.com")
	if verdict.Valid || verdict.MailboxVerified != "unknown" {
		t.Fatalf("greylist must be unknown: %+v", verdict)
	}
}

func TestSOCKS5ProxyIsUsed(t *testing.T) {
	host, port := startScriptedSMTP(t, func(line string) string {
		if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(line)), "RCPT") {
			return "550 5.1.1 User unknown"
		}
		return "250 ok"
	})
	var forwarded atomic.Int32
	proxyAddr := startSocks5(t, &forwarded)
	verdict := verifyMailbox("missing@example.com", "example.com", []string{host}, smtpSettings{
		Port:           port,
		ProxyURL:       "socks5://" + proxyAddr,
		HeloHost:       "example.com",
		MailFrom:       "verifier@example.com",
		ConnectTimeout: 2 * time.Second,
		SessionTimeout: 2 * time.Second,
	})
	if forwarded.Load() == 0 {
		t.Fatal("SMTP dial did not go through the SOCKS5 proxy")
	}
	if verdict.Valid || verdict.MailboxVerified != "no" {
		t.Fatalf("proxied 550 must be invalid: %+v", verdict)
	}
}

func TestProbeBanner(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = conn.Write([]byte("220 test.example ESMTP ready\r\n"))
		time.Sleep(200 * time.Millisecond)
	}()
	ok, detail := probeBanner(ln.Addr().String(), "", time.Second)
	if !ok {
		t.Fatalf("banner should be reachable, detail=%s", detail)
	}

	blackhole, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer blackhole.Close()
	go func() {
		conn, err := blackhole.Accept()
		if err != nil {
			return
		}
		time.Sleep(2 * time.Second)
		conn.Close()
	}()
	ok, detail = probeBanner(blackhole.Addr().String(), "", 200*time.Millisecond)
	if ok || !strings.Contains(detail, port25Reason) {
		t.Fatalf("stalled banner should be unreachable, ok=%v detail=%s", ok, detail)
	}
}

func verifyOn(t *testing.T, host string, port int, email string) smtpVerdict {
	t.Helper()
	return verifyMailbox(email, "example.com", []string{host}, smtpSettings{
		Port:           port,
		HeloHost:       "example.com",
		MailFrom:       "verifier@example.com",
		ConnectTimeout: 2 * time.Second,
		SessionTimeout: 2 * time.Second,
	})
}

func startScriptedSMTP(t *testing.T, reply func(line string) string) (string, int) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go serveSMTP(conn, reply)
		}
	}()
	return splitHostPort(t, ln.Addr().String())
}

func serveSMTP(conn net.Conn, reply func(line string) string) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := conn.Write([]byte("220 test ESMTP\r\n")); err != nil {
		return
	}
	reader := bufio.NewReader(conn)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		cmd := strings.ToUpper(strings.TrimSpace(line))
		response := "250 ok"
		switch {
		case strings.HasPrefix(cmd, "QUIT"):
			_, _ = conn.Write([]byte("221 bye\r\n"))
			return
		case strings.HasPrefix(cmd, "RCPT"), strings.HasPrefix(cmd, "MAIL"), strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
			response = reply(line)
		}
		if !strings.HasSuffix(response, "\r\n") {
			response += "\r\n"
		}
		if _, err := conn.Write([]byte(response)); err != nil {
			return
		}
	}
}

func startSocks5(t *testing.T, forwarded *atomic.Int32) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go handleSocks5(conn, forwarded)
		}
	}()
	return ln.Addr().String()
}

func handleSocks5(conn net.Conn, forwarded *atomic.Int32) bool {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 512)
	if _, err := io.ReadFull(conn, buf[:2]); err != nil {
		return false
	}
	nmethods := int(buf[1])
	if _, err := io.ReadFull(conn, buf[:nmethods]); err != nil {
		return false
	}
	if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
		return false
	}
	if _, err := io.ReadFull(conn, buf[:4]); err != nil || buf[1] != 0x01 {
		return false
	}
	var host string
	switch buf[3] {
	case 0x01:
		if _, err := io.ReadFull(conn, buf[:4]); err != nil {
			return false
		}
		host = net.IP(buf[:4]).String()
	case 0x03:
		if _, err := io.ReadFull(conn, buf[:1]); err != nil {
			return false
		}
		length := int(buf[0])
		if _, err := io.ReadFull(conn, buf[:length]); err != nil {
			return false
		}
		host = string(buf[:length])
	default:
		return false
	}
	if _, err := io.ReadFull(conn, buf[:2]); err != nil {
		return false
	}
	port := int(buf[0])<<8 | int(buf[1])
	dest, err := net.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		_, _ = conn.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return false
	}
	defer dest.Close()
	if _, err := conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
		return false
	}
	if forwarded != nil {
		forwarded.Add(1)
	}
	_ = conn.SetDeadline(time.Time{})
	_ = dest.SetDeadline(time.Time{})
	done := make(chan struct{}, 2)
	go func() {
		_, _ = io.Copy(dest, conn)
		done <- struct{}{}
	}()
	go func() {
		_, _ = io.Copy(conn, dest)
		done <- struct{}{}
	}()
	<-done
	return true
}

func splitHostPort(t *testing.T, addr string) (string, int) {
	t.Helper()
	host, portText, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatal(err)
	}
	return host, port
}
