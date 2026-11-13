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

// The verifier does not use truemail SmtpSafeCheck. That flag treats connection
// errors (including "dial tcp <mx>:25: i/o timeout") as a successful validation,
// which this service then reported as "250 OK". A mailbox is valid only when an
// MX accepts RCPT TO for that address and rejects a random probe.

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
}

type verifyResponse struct {
	Email           string      `json:"email"`
	DomainValid     bool        `json:"domain_valid"`
	MailboxVerified string      `json:"mailbox_verified"`
	Valid           bool        `json:"valid"`
	CatchAll        bool        `json:"catch_all,omitempty"`
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Mailforge-Smtp-Proxy, X-Mailforge-Smtp-Override, X-Mailforge-Helo-Host, X-Mailforge-Mail-From")
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
	domain = asciiDomain(domain)
	if domain == "" {
		return nil
	}
	mx, err := net.LookupMX(domain)
	if err != nil || len(mx) == 0 {
		return nil
	}
	sort.Slice(mx, func(i, j int) bool { return mx[i].Pref < mx[j].Pref })
	out := make([]mxRecord, 0, len(mx))
	for _, r := range mx {
		out = append(out, mxRecord{Host: strings.TrimSuffix(r.Host, "."), Priority: r.Pref})
	}
	return out
}

func verifyEmailAddress(email string, settings smtpSettings) (*verifyResponse, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	domain := ""
	if parts := strings.Split(email, "@"); len(parts) == 2 {
		domain = parts[1]
	}

	checks := []checkItem{}
	syntaxValid := false
	misc := miscInfo{}
	if parsed := miscVerifier.ParseAddress(email); parsed.Valid {
		syntaxValid = true
		if parsed.Domain != "" {
			domain = parsed.Domain
		}
		checks = append(checks, checkItem{Step: "syntax", Passed: true, Message: "The Email Address Syntax is correct"})
		misc.Disposable = miscVerifier.IsDisposable(parsed.Domain)
		misc.RoleAccount = miscVerifier.IsRoleAccount(parsed.Username)
		misc.Free = miscVerifier.IsFreeDomain(parsed.Domain)
	} else {
		checks = append(checks, checkItem{Step: "syntax", Passed: false, Message: "The Email Address Syntax is incorrect"})
	}

	if misc.Disposable {
		checks = append(checks, checkItem{Step: "misc", Passed: false, Message: "Disposable / temporary email domain detected"})
	} else if syntaxValid {
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
	domainValid := syntaxValid && len(mxRecords) > 0 && !misc.Disposable
	if !syntaxValid || domain == "" {
		// syntax check already recorded
	} else if len(mxRecords) == 0 {
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

	resp := &verifyResponse{
		Email:           email,
		DomainValid:     domainValid,
		MailboxVerified: "no_smtp",
		Valid:           false,
		Checks:          checks,
		MxRecords:       mxRecords,
		Misc:            misc,
		SyntaxValid:     syntaxValid,
		VerdictSummary:  email + " seems not to be valid",
	}
	if !syntaxValid {
		resp.VerdictSummary = email + " — syntax is invalid"
		return resp, nil
	}
	if len(mxRecords) == 0 {
		resp.VerdictSummary = email + " — no MX records found"
		return resp, nil
	}

	hosts := make([]string, 0, len(mxRecords))
	for _, mx := range mxRecords {
		if mx.Host != "" {
			hosts = append(hosts, mx.Host)
		}
	}
	verdict := verifyMailbox(email, domain, hosts, settings)
	resp.SmtpHost = verdict.Host
	resp.SmtpResponse = verdict.Response
	resp.MailboxVerified = verdict.MailboxVerified
	resp.Valid = verdict.Valid
	resp.CatchAll = verdict.CatchAll
	resp.SmtpCheckRan = verdict.Ran
	resp.VerdictSummary = verdict.Summary
	if verdict.CheckMessage != "" {
		resp.Checks = append(resp.Checks, checkItem{
			Step:    "smtp",
			Passed:  verdict.CheckPassed,
			Message: verdict.CheckMessage,
			Detail:  verdict.CheckDetail,
		})
	}
	return resp, nil
}

func healthHandler(w http.ResponseWriter, _ *http.Request, _ httprouter.Params) {
	settings := smtpSettingsFromRequest(nil)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":     "ok",
		"engine":     "mailforge-smtp + AfterShip misc",
		"smtp_port":  configuredSmtpPort(),
		"smtp_proxy": strings.TrimSpace(os.Getenv("SMTP_PROXY")) != "",
		"helo_host":  settings.HeloHost,
		"mail_from":  settings.MailFrom,
		"port25":     currentPort25(),
	})
}

func port25Handler(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	settings := smtpSettingsFromRequest(r)
	writeJSON(w, http.StatusOK, port25ForProxy(settings.ProxyURL))
}

func singleHandler(w http.ResponseWriter, r *http.Request, ps httprouter.Params) {
	email := ps.ByName("email")
	if email == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "email is required"})
		return
	}
	resp, err := verifyEmailAddress(email, smtpSettingsFromRequest(r))
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
	settings := smtpSettingsFromRequest(r)
	results := make([]interface{}, 0, len(req.Emails))
	for _, email := range req.Emails {
		resp, err := verifyEmailAddress(email, settings)
		if err != nil {
			results = append(results, map[string]string{"email": email, "error": err.Error()})
			continue
		}
		results = append(results, resp)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"count": len(results), "results": results})
}

func main() {
	go warmPort25()

	router := httprouter.New()
	router.GET("/health", healthHandler)
	router.GET("/port25", port25Handler)
	router.GET("/v1/:email/verification", singleHandler)
	router.POST("/v1/bulk/verification", bulkHandler)

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
	log.Printf("Email verifier API (RCPT TO, proxy-aware) listening on %s", addr)
	log.Fatal(server.ListenAndServe())
}
