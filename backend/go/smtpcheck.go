package main

import (
	"errors"
	"net"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

// smtpVerdict is the only place a mailbox is called deliverable.
// Valid is true only after the target RCPT TO is accepted and a random
// probe at the same domain is rejected (not catch-all).
type smtpVerdict struct {
	Host            string
	MailboxVerified string
	Valid           bool
	CatchAll        bool
	Response        string
	Summary         string
	CheckPassed     bool
	CheckMessage    string
	CheckDetail     string
	Ran             bool
	ConnFail        bool
}

type rcptOutcome struct {
	Stage string
	Code  int
	Text  string
	Err   error
}

func (o rcptOutcome) accepted() bool {
	return o.Err == nil && o.Code >= 200 && o.Code < 300
}

func (o rcptOutcome) tempFail() bool {
	return o.Code >= 400 && o.Code < 500
}

func (o rcptOutcome) connFail() bool {
	return o.Code == 0 && (o.Err != nil || o.Stage == "dial" || o.Stage == "banner")
}

func verifyMailbox(email, domain string, hosts []string, s smtpSettings) smtpVerdict {
	domain = asciiDomain(domain)
	if s.Port <= 0 {
		s.Port = 25
	}
	if s.ConnectTimeout <= 0 {
		s.ConnectTimeout = 8 * time.Second
	}
	if s.SessionTimeout <= 0 {
		s.SessionTimeout = 12 * time.Second
	}
	if len(hosts) == 0 {
		return smtpVerdict{
			MailboxVerified: "no_smtp",
			Summary:         email + " — no MX records found",
			CheckPassed:     false,
			CheckMessage:    "No MX records found for domain",
		}
	}

	limit := len(hosts)
	if limit > 2 {
		limit = 2
	}
	var last smtpVerdict
	for i := 0; i < limit; i++ {
		host := strings.TrimSuffix(strings.TrimSpace(hosts[i]), ".")
		if host == "" {
			continue
		}
		v := checkHost(email, domain, host, s)
		v.Host = host
		if v.ConnFail {
			last = v
			if isTimeoutErr(errors.New(v.Response)) || strings.Contains(strings.ToLower(v.Response), "i/o timeout") {
				break
			}
			continue
		}
		return v
	}
	if last.Response != "" || last.CheckMessage != "" {
		return last
	}
	return networkVerdict(email, "", s.ProxyURL, errors.New("no MX host answered"))
}

func checkHost(email, domain, host string, s smtpSettings) smtpVerdict {
	probe := oneRcpt(host, randomProbe(domain), s)
	if probe.connFail() {
		return networkVerdict(email, host, s.ProxyURL, probe.failure())
	}
	if probe.Stage != "rcpt" {
		return policyVerdict(email, host, probe.Text)
	}
	if probe.accepted() {
		return catchAllVerdict(email, host, probe.Text)
	}
	if probe.tempFail() || isGreylist(probe.Text) {
		return greylistVerdict(email, host, probe.Text)
	}
	if isPolicyBlock(probe.Text) {
		return policyVerdict(email, host, probe.Text)
	}

	real := oneRcpt(host, email, s)
	if real.connFail() {
		return networkVerdict(email, host, s.ProxyURL, real.failure())
	}
	if real.Stage != "rcpt" {
		return policyVerdict(email, host, real.Text)
	}
	if real.accepted() {
		return validVerdict(email, host, real.Text)
	}
	if real.tempFail() || isGreylist(real.Text) {
		return greylistVerdict(email, host, real.Text)
	}
	if isPolicyBlock(real.Text) {
		return policyVerdict(email, host, real.Text)
	}
	if real.Code >= 500 {
		return invalidVerdict(email, host, real.Text)
	}
	return policyVerdict(email, host, real.Text)
}

func oneRcpt(mxHost, recipient string, s smtpSettings) rcptOutcome {
	addr := net.JoinHostPort(mxHost, strconv.Itoa(s.Port))
	conn, err := dialSMTP(addr, s.ProxyURL, s.ConnectTimeout)
	if err != nil {
		return rcptOutcome{Stage: "dial", Err: err, Text: err.Error()}
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(s.SessionTimeout))

	client, err := smtp.NewClient(conn, mxHost)
	if err != nil {
		return outcomeFromErr("banner", err)
	}
	defer client.Close()

	if err = client.Hello(s.HeloHost); err != nil {
		return outcomeFromErr("hello", err)
	}
	if err = client.Mail(s.MailFrom); err != nil {
		return outcomeFromErr("mail", err)
	}
	if err = client.Rcpt(recipient); err != nil {
		return outcomeFromErr("rcpt", err)
	}
	return rcptOutcome{Stage: "rcpt", Code: 250, Text: "250 OK"}
}

func (o rcptOutcome) failure() error {
	if o.Err != nil {
		return o.Err
	}
	if o.Text != "" {
		return errors.New(o.Text)
	}
	return errors.New("smtp connection failed")
}

func outcomeFromErr(stage string, err error) rcptOutcome {
	if err == nil {
		return rcptOutcome{Stage: stage, Code: 250, Text: "250 OK"}
	}
	var te *textproto.Error
	if errors.As(err, &te) {
		return rcptOutcome{Stage: stage, Code: te.Code, Text: strings.TrimSpace(te.Error())}
	}
	text := strings.TrimSpace(err.Error())
	if code, ok := leadingSMTPCode(text); ok {
		return rcptOutcome{Stage: stage, Code: code, Text: text}
	}
	if stage == "banner" || stage == "dial" {
		return rcptOutcome{Stage: stage, Err: err, Text: text}
	}
	return rcptOutcome{Stage: stage, Err: err, Text: text}
}

func leadingSMTPCode(text string) (int, bool) {
	text = strings.TrimSpace(text)
	if len(text) < 3 {
		return 0, false
	}
	for i := 0; i < 3; i++ {
		if text[i] < '0' || text[i] > '9' {
			return 0, false
		}
	}
	code, err := strconv.Atoi(text[:3])
	if err != nil {
		return 0, false
	}
	return code, true
}

func networkVerdict(email, host, proxyURL string, err error) smtpVerdict {
	detail := connReason(proxyURL, err)
	message := port25Reason
	summary := email + " — " + port25Reason
	if strings.Contains(strings.ToLower(detail), "proxy") {
		message = proxyUnreachable
		summary = email + " — " + proxyUnreachable
	}
	return smtpVerdict{
		Host:            host,
		MailboxVerified: "unknown",
		Response:        detail,
		Summary:         summary,
		CheckPassed:     false,
		CheckMessage:    message,
		CheckDetail:     detail,
		Ran:             true,
		ConnFail:        true,
	}
}

func validVerdict(email, host, text string) smtpVerdict {
	if !strings.Contains(text, "250") {
		text = "250 OK"
	}
	return smtpVerdict{
		Host:            host,
		MailboxVerified: "yes",
		Valid:           true,
		Response:        text,
		Summary:         email + " seems to be valid",
		CheckPassed:     true,
		CheckMessage:    "RCPT TO accepted by " + host,
		CheckDetail:     text,
		Ran:             true,
	}
}

func invalidVerdict(email, host, text string) smtpVerdict {
	if text == "" {
		text = "550 mailbox rejected"
	}
	return smtpVerdict{
		Host:            host,
		MailboxVerified: "no",
		Response:        text,
		Summary:         email + " seems not to be valid",
		CheckPassed:     false,
		CheckMessage:    "RCPT TO rejected by " + host,
		CheckDetail:     text,
		Ran:             true,
	}
}

func catchAllVerdict(email, host, text string) smtpVerdict {
	if text == "" {
		text = "250 OK"
	}
	return smtpVerdict{
		Host:            host,
		MailboxVerified: "catch_all",
		CatchAll:        true,
		Response:        text,
		Summary:         email + " is risky/catch-all — the domain accepts every recipient",
		CheckPassed:     false,
		CheckMessage:    "Domain is catch-all / accept-all (risky)",
		CheckDetail:     "A random recipient was accepted by " + host + " (" + text + ")",
		Ran:             true,
	}
}

func greylistVerdict(email, host, text string) smtpVerdict {
	if text == "" {
		text = "451 try again later"
	}
	return smtpVerdict{
		Host:            host,
		MailboxVerified: "unknown",
		Response:        text,
		Summary:         email + " — could not verify (mail server asked us to try again later)",
		CheckPassed:     false,
		CheckMessage:    "Mail server asked us to try again later",
		CheckDetail:     text,
		Ran:             true,
	}
}

func policyVerdict(email, host, text string) smtpVerdict {
	if text == "" {
		text = "mail server rejected the SMTP policy check"
	}
	return smtpVerdict{
		Host:            host,
		MailboxVerified: "unknown",
		Response:        text,
		Summary:         email + " — could not verify (mail server blocked our IP / sender)",
		CheckPassed:     false,
		CheckMessage:    "Mail server blocked our IP or sender",
		CheckDetail:     text,
		Ran:             true,
	}
}

func isGreylist(text string) bool {
	lower := strings.ToLower(text)
	if strings.Contains(lower, "greylist") || strings.Contains(lower, "grey list") || strings.Contains(lower, "graylist") || strings.Contains(lower, "try again later") {
		return true
	}
	code, ok := leadingSMTPCode(text)
	return ok && (code == 421 || code == 450 || code == 451 || code == 452)
}

func isPolicyBlock(text string) bool {
	lower := strings.ToLower(text)
	phrases := []string{
		"service unavailable",
		"access denied",
		"client host",
		"sender address rejected",
		"does not accept mail",
		"nullmx",
		"blocked",
		"tss09",
		"tss11",
		"spamhaus",
		"blacklist",
		"not permitted",
		"relay access denied",
	}
	for _, p := range phrases {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}
