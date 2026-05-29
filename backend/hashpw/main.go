// Command hashpw generates a bcrypt hash for a password so it can be stored in
// the backend users file (format: `username:bcrypt_hash`, one per line).
//
// Usage:
//
//	go run ./hashpw            # prompts for the password (not echoed back here)
//	go run ./hashpw 'secret'   # hashes the given password
//
// Then put the output in users.txt:
//
//	admin:$2a$10$....
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	var pw string
	if len(os.Args) > 1 {
		pw = os.Args[1]
	} else {
		fmt.Fprint(os.Stderr, "Password: ")
		line, _ := bufio.NewReader(os.Stdin).ReadString('\n')
		pw = strings.TrimRight(line, "\r\n")
	}
	if pw == "" {
		fmt.Fprintln(os.Stderr, "error: empty password")
		os.Exit(1)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println(string(hash))
}
