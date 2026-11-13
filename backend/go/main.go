package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	emailVerifier "github.com/AfterShip/email-verifier"
	"github.com/julienschmidt/httprouter"
)

var miscVerifier = emailVerifier.NewVerifier()

type mxRecord struct {
	Host     string `json:"host"`
	Priority uint16 `json:"priority"`
}

type checkItem struct {
	Step    string `json:"step"`
	Passed  bool   `json:"passed"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

type miscInfo struct {
	Disposable  bool `json:"disposable"`
	RoleAccount bool `json:"role_account"`
	Free        bool `json:"free_provider"`
	CatchAll    bool `json:"catch_all,omitempty"`
}

type verifyResponse struct {
	Email           string      `json:"email"`
	DomainValid     bool        `json:"domain_valid"`
	MailboxVerified string      `json:"mailbox_verified"`
	Valid           bool        `json:"valid"`
	Checks          []checkItem `json:"checks"`
	MxRecords       []mxRecord  `json:"mx_records"`
	Misc            miscInfo    `json:"misc"`
	SmtpHost        string      `json:"smtp_host,omitempty"`
	SmtpResponse    string      `json:"smtp_response,omitempty"`
	VerdictSummary  string      `json:"verdict_summary"`
	SyntaxValid     bool        `json:"syntax_valid"`
	SmtpCheckRan    bool        `json:"smtp_check_ran"`
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Mailforge-Smtp-Proxy, X-Mailforge-Smtp-Helo, X-Mailforge-Smtp-From")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func configuredSmtpPort() int {
	port := 25
	if p := os.Getenv("SMTP_PORT"); p != "" {
		var parsed int
		if _, err := fmt.Sscanf(p, "%d", &parsed); err == nil && parsed > 0 {
			port = parsed
		}
	}
	return port
}

func lookupMX(domain string) []mxRecord {
	mx, err := net.LookupMX(domain)
	if err != nil || len(mx) == 0 {
		return nil
	}
	sort.Slice(mx, func(i, j int) bool { return mx[i].Pref < mx[j].Pref })
	out := make([]mxRecord, 0, len(mx))
	for _, record := range mx {
		host := strings.TrimSuffix(record.Host, ".")
		if host == "" || host == "." {
			continue
		}
		out = append(out, mxRecord{Host: host, Priority: record.Pref})
	}
	return out
}

func smtpOptsFromRequest(r *http.Request) smtpOpts {
	if r == nil {
		r = &http.Request{}
	}
	from := firstNonEmpty(r.Header.Get("X-Mailforge-Smtp-From"), envFrom())
	return normalizeOpts(smtpOpts{
		Proxy: firstNonEmpty(r.Header.Get("X-Mailforge-Smtp-Proxy"), envProxy()),
		Helo:  firstNonEmpty(r.Header.Get("X-Mailforge-Smtp-Helo"), envHelo(from)),
		From:  from,
		Port:  configuredSmtpPort(),
	})
}

func verifyEmailAddress(email string, opts smtpOpts) (*verifyResponse, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	opts = normalizeOpts(opts)
	parsed := miscVerifier.ParseAddress(email)
	syntaxValid := parsed.Valid
	domain := parsed.Domain
	if domain == "" {
		if at := strings.LastIndex(email, "@"); at >= 0 && at < len(email)-1 {
			domain = email[at+1:]
		}
	}

	checks := []checkItem{}
	if syntaxValid {
		checks = append(checks, checkItem{Step: "syntax", Passed: true, Message: "The Email Address Syntax is correct"})
	} else {
		checks = append(checks, checkItem{Step: "syntax", Passed: false, Message: "The Email Address Syntax is incorrect"})
	}

	misc := miscInfo{}
	if syntaxValid {
		misc.Disposable = miscVerifier.IsDisposable(domain)
		misc.RoleAccount = miscVerifier.IsRoleAccount(parsed.Username)
		misc.Free = miscVerifier.IsFreeDomain(domain)
	}
	if misc.Disposable {
		checks = append(checks, checkItem{Step: "misc", Passed: false, Message: "Disposable / temporary email domain detected"})
	} else {
		checks = append(checks, checkItem{Step: "misc", Passed: true, Message: "Not a known disposable domain"})
	}
	if misc.RoleAccount {
		checks = append(checks, checkItem{Step: "misc", Passed: false, Message: "Role-based email account (admin, info, etc.)"})
	}
	if misc.Free {
		checks = append(checks, checkItem{Step: "misc", Passed: true, Message: "Known free email provider"})
	}

	var mxRecords []mxRecord
	if syntaxValid && domain != "" {
		mxRecords = lookupMX(domain)
	}
	if len(mxRecords) == 0 {
		checks = append(checks, checkItem{Step: "mx", Passed: false, Message: "No MX records found for domain"})
	} else {
		for _, mx := range mxRecords {
			checks = append(checks, checkItem{
				Step:    "mx",
				Passed:  true,
				Message: fmt.Sprintf("MX record found: %s (Priority %d)", mx.Host, mx.Priority),
			})
		}
	}

	domainValid := syntaxValid && len(mxRecords) > 0 && !misc.Disposable
	mailboxVerified := "no"
	valid := false
	summary := email + " seems not to be valid"
	smtpHost := ""
	smtpResponse := ""
	smtpRan := false

	if syntaxValid && len(mxRecords) > 0 && !misc.Disposable {
		result := checkMailbox(email, mxRecords, opts)
		smtpRan = result.Ran
		smtpHost = result.Host
		smtpResponse = result.Response
		mailboxVerified = result.MailboxVerified
		if mailboxVerified == "" {
			mailboxVerified = "unknown"
		}
		valid = result.Valid && mailboxVerified == "yes" && !result.CatchAll
		misc.CatchAll = result.CatchAll
		if result.Summary != "" {
			summary = result.Summary
			if !strings.Contains(summary, email) {
				summary = email + " — " + summary
			}
		}
		if smtpRan {
			detail := smtpResponse
			if detail == "" {
				detail = result.CheckMessage
			}
			checks = append(checks, checkItem{
				Step:    "smtp",
				Passed:  result.Passed && valid,
				Message: result.CheckMessage,
				Detail:  detail,
			})
		}
	} else if misc.Disposable {
		mailboxVerified = "no_smtp"
		summary = email + " — disposable domain"
	} else if domainValid {
		mailboxVerified = "unknown"
		summary = email + " — could not verify"
	} else {
		mailboxVerified = "no"
	}

	return &verifyResponse{
		Email:           email,
		DomainValid:     domainValid,
		MailboxVerified: mailboxVerified,
		Valid:           valid,
		Checks:          checks,
		MxRecords:       mxRecords,
		Misc:            misc,
		SmtpHost:        smtpHost,
		SmtpResponse:    smtpResponse,
		VerdictSummary:  summary,
		SyntaxValid:     syntaxValid,
		SmtpCheckRan:    smtpRan,
	}, nil
}

func healthHandler(w http.ResponseWriter, _ *http.Request, _ httprouter.Params) {
	probe := currentSMTPProbe(false)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":                "ok",
		"engine":                "truemail-go",
		"smtp_port":             configuredSmtpPort(),
		"smtp_proxy_configured": probe["proxy_configured"],
		"smtp_proxy_reachable":  probe["proxy_reachable"],
		"smtp_port25_ok":        probe["port25_ok"],
		"smtp_via":              probe["via"],
		"smtp_detail":           probe["detail"],
		"smtp":                  probe,
	})
}

func singleHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	email := ps.ByName("email")
	if email == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email is required"})
		return
	}
	resp, err := verifyEmailAddress(email, smtpOptsFromRequest(r))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

type bulkRequest struct {
	Emails []string `json:"emails"`
}

func bulkHandler(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	var req bulkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	opts := smtpOptsFromRequest(r)
	results := make([]interface{}, 0, len(req.Emails))
	for _, email := range req.Emails {
		resp, err := verifyEmailAddress(email, opts)
		if err != nil {
			results = append(results, map[string]string{"email": email, "error": err.Error()})
			continue
		}
		results = append(results, resp)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"count": len(results), "results": results})
}

func main() {
	router := httprouter.New()
	router.GET("/health", healthHandler)
	router.GET("/v1/:email/verification", singleHandler)
	router.POST("/v1/bulk/verification", bulkHandler)

	go func() {
		probe := currentSMTPProbe(true)
		log.Printf("smtp probe via=%v port25_ok=%v proxy_configured=%v proxy_reachable=%v detail=%v",
			probe["via"], probe["port25_ok"], probe["proxy_configured"], probe["proxy_reachable"], probe["detail"])
	}()

	addr := ":8082"
	if p := os.Getenv("VERIFIER_GO_PORT"); p != "" {
		addr = ":" + strings.TrimPrefix(p, ":")
	}
	server := &http.Server{
		Addr:         addr,
		Handler:      cors(router),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 180 * time.Second,
	}
	log.Printf("Email verifier API listening on %s (smtp port %d)", addr, configuredSmtpPort())
	log.Fatal(server.ListenAndServe())
}
