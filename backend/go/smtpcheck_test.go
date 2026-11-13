package main

import (
	"bufio"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestClassifyPolicy554IsUnknown(t *testing.T) {
	text := "554-No SMTP service | 554-Invalid DNS PTR resource record | 554 see https://www.spamhaus.org/pbl"
	class := classifySMTPText(text)
	if class.Kind != "unknown" {
		t.Fatalf("kind %s", class.Kind)
	}
	if class.Reason != "policy rejection, not a mailbox result" {
		t.Fatalf("reason %s", class.Reason)
	}
}

func TestClassifyMailbox550IsInvalid(t *testing.T) {
	class := classifySMTPText("550 5.1.1 The email account that you tried to reach does not exist")
	if class.Kind != "invalid" {
		t.Fatalf("kind %s", class.Kind)
	}
}

func TestClassifyTimeoutIsUnknown(t *testing.T) {
	class := classifySMTPText("dial tcp 142.0.0.1:25: i/o timeout")
	if class.Kind != "unknown" || !strings.Contains(class.Reason, "SMTP port 25 unreachable") {
		t.Fatalf("%+v", class)
	}
}

func TestClassifyGreylist421IsUnknown(t *testing.T) {
	class := classifySMTPText("421 4.7.0 Try again later")
	if class.Kind != "unknown" {
		t.Fatalf("kind %s", class.Kind)
	}
}

func startSMTP(t *testing.T, reply func(line string) string) (string, *[]string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	var mu sync.Mutex
	cmds := []string{}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				reader := bufio.NewReader(c)
				writer := bufio.NewWriter(c)
				send := func(line string) {
					_, _ = writer.WriteString(line + "\r\n")
					_ = writer.Flush()
				}
				send("220 test ESMTP")
				for {
					line, err := reader.ReadString('\n')
					if err != nil {
						return
					}
					line = strings.TrimSpace(line)
					mu.Lock()
					cmds = append(cmds, line)
					mu.Unlock()
					upper := strings.ToUpper(line)
					switch {
					case strings.HasPrefix(upper, "EHLO"), strings.HasPrefix(upper, "HELO"):
						send("250 hello")
					case strings.HasPrefix(upper, "MAIL"):
						send("250 OK")
					case strings.HasPrefix(upper, "RCPT"):
						send(reply(line))
					case strings.HasPrefix(upper, "QUIT"):
						send("221 bye")
						return
					default:
						send("250 OK")
					}
				}
			}(conn)
		}
	}()
	return ln.Addr().String(), &cmds
}

func optsFor(addr string) smtpOpts {
	_, portText, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(portText)
	return smtpOpts{
		Helo:           "mail.example.com",
		From:           "verify@example.com",
		Port:           port,
		DialTimeout:    time.Second,
		SessionTimeout: time.Second,
		Proxy:          "",
	}
}

func TestSMTP250Then550IsValid(t *testing.T) {
	addr, cmds := startSMTP(t, func(line string) string {
		if strings.Contains(strings.ToLower(line), "mfprobe-") {
			return "550 5.1.1 User unknown"
		}
		return "250 2.1.5 OK"
	})
	host, _ := splitHost(addr)
	result := checkMailbox("real.user@example.com", []mxRecord{{Host: host, Priority: 1}}, optsFor(addr))
	if !result.Valid || result.MailboxVerified != "yes" {
		t.Fatalf("%+v", result)
	}
	if !strings.Contains(result.Response, "250") {
		t.Fatalf("response %s", result.Response)
	}
	joined := strings.ToLower(strings.Join(*cmds, "\n"))
	if !strings.Contains(joined, "ehlo mail.example.com") || !strings.Contains(joined, "mail from:<verify@example.com>") {
		t.Fatalf("commands %s", joined)
	}
}

func TestSMTP550IsInvalid(t *testing.T) {
	addr, _ := startSMTP(t, func(string) string {
		return "550 5.1.1 User unknown"
	})
	host, _ := splitHost(addr)
	result := checkMailbox("fake.user@example.com", []mxRecord{{Host: host, Priority: 1}}, optsFor(addr))
	if result.Valid || result.MailboxVerified != "no" {
		t.Fatalf("%+v", result)
	}
}

func TestSMTP554PTRIsUnknown(t *testing.T) {
	addr, _ := startSMTP(t, func(string) string {
		return "554 Invalid DNS PTR resource record No SMTP service"
	})
	host, _ := splitHost(addr)
	result := checkMailbox("postmaster@gmx.net", []mxRecord{{Host: host, Priority: 1}}, optsFor(addr))
	if result.Valid || result.MailboxVerified != "unknown" {
		t.Fatalf("%+v", result)
	}
	if result.MailboxVerified == "no" {
		t.Fatal("policy 554 was treated as a mailbox reject")
	}
}

func TestSMTP550OnCatchallNamedAddressIsInvalid(t *testing.T) {
	addr, _ := startSMTP(t, func(line string) string {
		lower := strings.ToLower(line)
		if strings.Contains(lower, "zzzcatchallprobe999") {
			return "550 5.1.1 <zzzcatchallprobe999@proton.me>: Address does not exist"
		}
		return "250 2.1.5 OK"
	})
	host, _ := splitHost(addr)
	result := checkMailbox("zzzcatchallprobe999@proton.me", []mxRecord{{Host: host, Priority: 1}}, optsFor(addr))
	if result.Valid || result.CatchAll || result.MailboxVerified != "no" {
		t.Fatalf("%+v", result)
	}
	if !strings.Contains(result.Response, "550") || !strings.Contains(result.Response, "does not exist") {
		t.Fatalf("response %s", result.Response)
	}
}

func TestSMTPCatchAllIsRisky(t *testing.T) {
	addr, _ := startSMTP(t, func(string) string {
		return "250 2.1.5 OK"
	})
	host, _ := splitHost(addr)
	result := checkMailbox("anyone@example.com", []mxRecord{{Host: host, Priority: 1}}, optsFor(addr))
	if result.Valid || !result.CatchAll || result.MailboxVerified != "catch_all" {
		t.Fatalf("%+v", result)
	}
}

func TestClosedPortIsUnknown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	host, portText, _ := net.SplitHostPort(addr)
	port, _ := strconv.Atoi(portText)
	result := checkMailbox("a@example.com", []mxRecord{{Host: host, Priority: 1}}, smtpOpts{
		Helo:           "mail.example.com",
		From:           "verify@example.com",
		Port:           port,
		DialTimeout:    400 * time.Millisecond,
		SessionTimeout: time.Second,
	})
	if result.Valid || result.MailboxVerified != "unknown" {
		t.Fatalf("%+v", result)
	}
	if !strings.Contains(strings.ToLower(result.Response), "smtp port 25 unreachable") {
		t.Fatalf("response %s", result.Response)
	}
}

func TestProxyOfflineIsUnknown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	_ = ln.Close()
	_, portText, _ := net.SplitHostPort(addr)
	result := checkMailbox("a@example.com", []mxRecord{{Host: "127.0.0.1", Priority: 1}}, smtpOpts{
		Proxy:          "socks5://127.0.0.1:" + portText,
		Helo:           "mail.example.com",
		From:           "verify@example.com",
		Port:           25,
		DialTimeout:    400 * time.Millisecond,
		SessionTimeout: time.Second,
	})
	if result.Valid || result.MailboxVerified != "unknown" {
		t.Fatalf("%+v", result)
	}
	if !strings.Contains(strings.ToLower(result.Response), "verification proxy offline") {
		t.Fatalf("response %s", result.Response)
	}
}

func TestSOCKS5ProxyIsUsedForAcceptance(t *testing.T) {
	smtpAddr, _ := startSMTP(t, func(line string) string {
		if strings.Contains(strings.ToLower(line), "mfprobe-") {
			return "550 5.1.1 User unknown"
		}
		return "250 2.1.5 OK"
	})
	proxyAddr, hits := startSocks(t)
	smtpHost, smtpPortText, _ := net.SplitHostPort(smtpAddr)
	smtpPort, _ := strconv.Atoi(smtpPortText)
	result := checkMailbox("real.user@example.com", []mxRecord{{Host: smtpHost, Priority: 1}}, smtpOpts{
		Proxy:          "socks5://" + proxyAddr,
		Helo:           "mail.example.com",
		From:           "verify@example.com",
		Port:           smtpPort,
		DialTimeout:    2 * time.Second,
		SessionTimeout: 2 * time.Second,
	})
	if !result.Valid || result.MailboxVerified != "yes" {
		t.Fatalf("%+v", result)
	}
	if *hits < 1 {
		t.Fatal("verifier dialed without the SOCKS5 proxy")
	}
}

func splitHost(addr string) (string, string) {
	host, _, _ := net.SplitHostPort(addr)
	return host, addr
}

func startSocks(t *testing.T) (string, *int) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	hits := 0
	var mu sync.Mutex
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			mu.Lock()
			hits++
			mu.Unlock()
			go handleSocks(conn)
		}
	}()
	return ln.Addr().String(), &hits
}

func handleSocks(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	header := make([]byte, 2)
	if _, err := io.ReadFull(conn, header); err != nil {
		return
	}
	methods := make([]byte, int(header[1]))
	if _, err := io.ReadFull(conn, methods); err != nil {
		return
	}
	if _, err := conn.Write([]byte{0x05, 0x00}); err != nil {
		return
	}
	req := make([]byte, 4)
	if _, err := io.ReadFull(conn, req); err != nil {
		return
	}
	var host string
	switch req[3] {
	case 0x01:
		ip := make([]byte, 4)
		if _, err := io.ReadFull(conn, ip); err != nil {
			return
		}
		host = net.IP(ip).String()
	case 0x03:
		length := make([]byte, 1)
		if _, err := io.ReadFull(conn, length); err != nil {
			return
		}
		name := make([]byte, int(length[0]))
		if _, err := io.ReadFull(conn, name); err != nil {
			return
		}
		host = string(name)
	case 0x04:
		ip := make([]byte, 16)
		if _, err := io.ReadFull(conn, ip); err != nil {
			return
		}
		host = net.IP(ip).String()
	default:
		return
	}
	portBytes := make([]byte, 2)
	if _, err := io.ReadFull(conn, portBytes); err != nil {
		return
	}
	port := int(portBytes[0])<<8 | int(portBytes[1])
	dest, err := net.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		_, _ = conn.Write([]byte{0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0})
		return
	}
	defer dest.Close()
	if _, err = conn.Write([]byte{0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0}); err != nil {
		return
	}
	_ = conn.SetDeadline(time.Time{})
	_ = dest.SetDeadline(time.Time{})
	go func() { _, _ = io.Copy(dest, conn) }()
	_, _ = io.Copy(conn, dest)
}
