package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
)

const proxyPort = 8899

var (
	hostMappings = make(map[string]string)
	mappingsMu   sync.RWMutex
	server       *http.Server
	listener     net.Listener
)

// Native messaging message types
type Message struct {
	Action   string            `json:"action,omitempty"`
	Type     string            `json:"type,omitempty"`
	Mappings map[string]string `json:"mappings,omitempty"`
	Message  string            `json:"message,omitempty"`
	Port     int               `json:"port,omitempty"`
	Count    int               `json:"count,omitempty"`
}

// Read a native messaging message from stdin
func readMessage(reader *bufio.Reader) (*Message, error) {
	// Read 4-byte length prefix (little-endian)
	lengthBytes := make([]byte, 4)
	if _, err := io.ReadFull(reader, lengthBytes); err != nil {
		return nil, err
	}
	length := binary.LittleEndian.Uint32(lengthBytes)

	// Read message body
	messageBytes := make([]byte, length)
	if _, err := io.ReadFull(reader, messageBytes); err != nil {
		return nil, err
	}

	var msg Message
	if err := json.Unmarshal(messageBytes, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

// Write a native messaging message to stdout
func sendMessage(msg Message) {
	messageBytes, err := json.Marshal(msg)
	if err != nil {
		return
	}

	lengthBytes := make([]byte, 4)
	binary.LittleEndian.PutUint32(lengthBytes, uint32(len(messageBytes)))

	os.Stdout.Write(lengthBytes)
	os.Stdout.Write(messageBytes)
}

// Log a message back to the extension
func logToExtension(format string, args ...interface{}) {
	sendMessage(Message{Type: "log", Message: fmt.Sprintf(format, args...)})
}

// Get the target host for a given hostname (with mapping lookup)
func getTargetHost(hostname string) string {
	mappingsMu.RLock()
	defer mappingsMu.RUnlock()

	if mapped, ok := hostMappings[hostname]; ok {
		return mapped
	}
	return hostname
}

// Handle HTTPS CONNECT tunneling
func handleConnect(w http.ResponseWriter, r *http.Request) {
	// Parse host:port from request
	host, port, err := net.SplitHostPort(r.Host)
	if err != nil {
		host = r.Host
		port = "443"
	}

	// Look up mapping
	targetHost := getTargetHost(host)
	targetAddr := net.JoinHostPort(targetHost, port)

	if targetHost != host {
		logToExtension("Tunneling %s -> %s", r.Host, targetAddr)
	}

	// Connect to target
	targetConn, err := net.Dial("tcp", targetAddr)
	if err != nil {
		sendMessage(Message{Type: "error", Message: fmt.Sprintf("Failed to connect to %s: %v", targetAddr, err)})
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
		return
	}

	// Hijack the client connection
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		targetConn.Close()
		http.Error(w, "Hijacking not supported", http.StatusInternalServerError)
		return
	}

	clientConn, _, err := hijacker.Hijack()
	if err != nil {
		targetConn.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Send 200 Connection Established
	clientConn.Write([]byte("HTTP/1.1 200 Connection Established\r\n\r\n"))

	// Tunnel data bidirectionally
	go func() {
		io.Copy(targetConn, clientConn)
		targetConn.Close()
	}()
	go func() {
		io.Copy(clientConn, targetConn)
		clientConn.Close()
	}()
}

// Handle regular HTTP proxy requests
func handleHTTP(w http.ResponseWriter, r *http.Request) {
	// Parse the target URL
	host := r.URL.Hostname()
	port := r.URL.Port()
	if port == "" {
		port = "80"
	}

	// Look up mapping
	targetHost := getTargetHost(host)

	if targetHost != host {
		logToExtension("Proxying HTTP %s -> %s", host, targetHost)
	}

	// Create the target URL
	targetURL := *r.URL
	targetURL.Host = net.JoinHostPort(targetHost, port)

	// Create proxy request
	proxyReq, err := http.NewRequest(r.Method, targetURL.String(), r.Body)
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	// Copy headers, but set correct Host header
	for key, values := range r.Header {
		for _, value := range values {
			proxyReq.Header.Add(key, value)
		}
	}
	proxyReq.Header.Set("Host", host) // Original host for virtual hosting

	// Make the request
	client := &http.Client{}
	resp, err := client.Do(proxyReq)
	if err != nil {
		sendMessage(Message{Type: "error", Message: fmt.Sprintf("HTTP proxy error: %v", err)})
		http.Error(w, "Bad Gateway", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(resp.StatusCode)

	// Copy response body
	io.Copy(w, resp.Body)
}

// Main proxy handler
func proxyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodConnect {
		handleConnect(w, r)
	} else {
		handleHTTP(w, r)
	}
}

// Start the proxy server
func startProxy(mappings map[string]string) error {
	if listener != nil {
		return nil // Already running
	}

	// Update mappings
	mappingsMu.Lock()
	hostMappings = mappings
	mappingsMu.Unlock()

	// Create listener
	var err error
	listener, err = net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", proxyPort))
	if err != nil {
		return err
	}

	// Create server
	server = &http.Server{
		Handler: http.HandlerFunc(proxyHandler),
	}

	// Start serving in background
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			sendMessage(Message{Type: "error", Message: fmt.Sprintf("Server error: %v", err)})
		}
	}()

	sendMessage(Message{Type: "started", Port: proxyPort})
	return nil
}

// Stop the proxy server
func stopProxy() {
	if server != nil {
		server.Close()
		server = nil
	}
	if listener != nil {
		listener.Close()
		listener = nil
	}
	sendMessage(Message{Type: "stopped"})
}

// Update host mappings
func updateMappings(mappings map[string]string) {
	mappingsMu.Lock()
	hostMappings = mappings
	mappingsMu.Unlock()
	sendMessage(Message{Type: "mappingsUpdated", Count: len(mappings)})
}

func main() {
	// Send ready message
	sendMessage(Message{Type: "ready"})

	// Read messages from stdin
	reader := bufio.NewReader(os.Stdin)

	for {
		msg, err := readMessage(reader)
		if err != nil {
			if err == io.EOF || strings.Contains(err.Error(), "file already closed") {
				// Extension disconnected, clean up and exit
				stopProxy()
				os.Exit(0)
			}
			continue
		}

		switch msg.Action {
		case "start":
			if err := startProxy(msg.Mappings); err != nil {
				sendMessage(Message{Type: "error", Message: fmt.Sprintf("Failed to start proxy: %v", err)})
			}

		case "updateMappings":
			updateMappings(msg.Mappings)

		case "stop":
			stopProxy()
			os.Exit(0)

		case "ping":
			sendMessage(Message{Type: "pong"})

		default:
			sendMessage(Message{Type: "error", Message: fmt.Sprintf("Unknown action: %s", msg.Action)})
		}
	}
}
