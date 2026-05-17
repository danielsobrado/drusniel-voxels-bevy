# Multiplayer Connection Requirements

Document status (2026-05-17): current technical note; verify file paths against code when editing.

This guide outlines the requirements for running a simple two-player multiplayer session where one player acts as the server host and the other joins as a client using an IP address, port, and password.

## Host (Server) Requirements
- Run the game with hosting enabled so it listens for incoming connections.
- Provide a reachable IPv4 or IPv6 address; if behind NAT, configure port forwarding on the router.
- Choose a TCP/UDP port (as required by the game) and ensure it is open on the host firewall.
- Set a strong session password to limit access to invited players.
- Share with the client the public IP address (or LAN IP), chosen port, and password.

## Client Requirements
- Enter the host-provided IP address and port in the connection UI.
- Supply the session password exactly as provided.
- Ensure outbound traffic on the selected port is allowed by the local firewall or security software.

## Connection Steps
1. The host starts the game in server mode and notes the IP address, port, and password.
2. The host communicates these details to the client (out of band).
3. The client opens the multiplayer join screen and inputs the IP, port, and password.
4. The client connects; the server authenticates the password before allowing entry.

## Troubleshooting
- If the client cannot connect, verify the host is running and listening on the specified port.
- Confirm that port forwarding and firewall rules are correct on the host machine.
- Double-check the IP address, port number, and password for typos.
- If using IPv6, confirm both players are on IPv6-capable networks.
