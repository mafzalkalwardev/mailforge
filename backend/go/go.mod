module bulk-email-verifier-go

go 1.22

replace github.com/AfterShip/email-verifier => ../../lib/email-verifier

require (
	github.com/AfterShip/email-verifier v0.0.0
	github.com/julienschmidt/httprouter v1.3.0
	golang.org/x/net v0.29.0
)

require (
	github.com/hbollon/go-edlib v1.6.0 // indirect
	golang.org/x/text v0.18.0 // indirect
)
