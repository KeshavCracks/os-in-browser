import codeMap from "./code-map.json" with { type: "json" };

const sharedBytes = new Uint8Array(13);
const sharedView = new DataView(sharedBytes.buffer);
const screenshare = document.getElementById("screenshare");
const tunnelFrame = document.getElementById("tunnel-frame");
let pointerMovementChannel, pointerClickChannel, keyboardTypeChannel, pointerScrollChannel, clipboardSyncChannel;
let lastClipboardValue;
let tunnelWs = null;
let webrtcLive = false;
let lastTunnelUrl = null;

const ICE_CONFIG = {
	iceCandidatePoolSize: 10,
	bundlePolicy: "max-bundle",
	iceServers: [
		{
			urls: [
				"stun:stun.l.google.com:19302",
				"stun:stun1.l.google.com:19302",
				"stun:stun2.l.google.com:19302",
				"stun:stun3.l.google.com:19302",
				"stun:stun4.l.google.com:19302",
				"stun:stun.cloudflare.com:3478"
			]
		},
		// TCP/TLS TURN helps when UDP STUN is blocked (Cloudflare WARP, some VPNs/firewalls)
		{
			urls: [
				"turn:openrelay.metered.ca:80",
				"turn:openrelay.metered.ca:443",
				"turn:openrelay.metered.ca:443?transport=tcp",
				"turns:openrelay.metered.ca:443"
			],
			username: "openrelayproject",
			credential: "openrelayproject"
		}
	]
};

export default class ClientPeer extends RTCPeerConnection {
	static #Init = ICE_CONFIG;

	signalingWs = null;
	#remoteDescriptionReady = Promise.withResolvers();

	constructor (signalingUrl) {
		// Pointer lock makes events added to "screenshare" element not work since document.documentElement is the one requesting for pointer lock - a child of "window".
		super(ClientPeer.#Init);

		this.signalingWs = new WebSocket(signalingUrl);
		this.signalingWs.binaryType = "arraybuffer";
		tunnelWs = this.signalingWs;
		const pingInterval = setInterval(() => this.#sendWSMessage("ping"), 1337);
		this.signalingWs.addEventListener("close", () => clearInterval(pingInterval));
		this.signalingWs.addEventListener("message", this.#onTrickleICEMessage.bind(this));
		this.signalingWs.addEventListener("open", () => {
			this.addTransceiver("video", {
				direction: "recvonly"
			});

			this.addTransceiver("audio", {
				direction: "recvonly"
			});

			this.#initializeDataChannels();
		});

		this.addEventListener("track", ClientPeer.#OnTrack.bind(ClientPeer));
		this.addEventListener("negotiationneeded", this.#onNegotiationNeeded.bind(this));
		this.addEventListener("connectionstatechange", this.#onConnectionStateChange.bind(this));
		this.addEventListener("icecandidate", this.#onICECandidate.bind(this));

		ClientPeer.#SetRemoteControlMode(true);
	}

	async #onNegotiationNeeded() {
		if (this.signalingState !== "stable") return;

		const offer = await this.createOffer();
		await this.setLocalDescription(offer);
		this.#sendWSMessage("offer", this.localDescription);
	}

	#initializeDataChannels() {
		// maybe remove negotiated, idk
		pointerMovementChannel = this.createDataChannel("pointer-movement", {
			ordered: false,
			maxRetransmits: 0,
			negotiated: true,
			id: 0
		});

		pointerClickChannel = this.createDataChannel("pointer-click", {
			ordered: true,
			negotiated: true,
			id: 1
		});

		pointerScrollChannel = this.createDataChannel("pointer-scroll", {
			ordered: false,
			maxRetransmits: 0,
			negotiated: true,
			id: 2
		});

		keyboardTypeChannel = this.createDataChannel("keyboard-type", {
			ordered: true,
			negotiated: true,
			id: 3
		});

		clipboardSyncChannel = this.createDataChannel("clipboard-sync", {
            ordered: true,
            negotiated: true,
            id: 4
        });

		clipboardSyncChannel.addEventListener("message", ({ data }) => {
			if (typeof(navigator.clipboard?.writeText) !== "function" || !document.hasFocus()) return;
			navigator.clipboard.writeText(data);
		});
	}

	#onConnectionStateChange() {
		const { connectionState, signalingWs } = this;
		switch (connectionState) {
			case "failed": {
				webrtcLive = false;
				if (signalingWs.readyState === signalingWs.OPEN) {
					this.restartIce();
				}
				break;
			}

			case "disconnected": {
				webrtcLive = false;
				break;
			}

			case "closed": {
				webrtcLive = false;
				break;
			}

			case "connected":
				webrtcLive = true;
				if (tunnelFrame) tunnelFrame.style.display = "none";
				break;

			case "connecting":
			case "new":
				break;

			default: {
				console.warn(`Unknown connection state: ${connectionState}`);
				break;
			}
		}
	}

	#onICECandidate({ candidate }) {
		if (candidate) this.#sendWSMessage("ice-candidate", candidate);
	}

	async #onTrickleICEMessage(event) {
		if (event.data instanceof ArrayBuffer) {
			ClientPeer.#OnTunnelFrame(event.data);
			return;
		}

		let data;
		try { data = JSON.parse(event.data); } catch { return; }

		switch (data.type) {
			case "answer": {
				await this.setRemoteDescription(data.message);
				this.#remoteDescriptionReady.resolve();
				break;
			}

			case "ice-candidate": {
				await this.#remoteDescriptionReady.promise;
				await this.addIceCandidate(data.message);
				break;
			}

			case "ping": break;

			default: {
				console.error(`Unknown packet type: ${data.type}`);
				break;
			}
		}
	}

	#sendWSMessage(type, message) {
		const { signalingWs } = this;
		if (signalingWs.readyState === signalingWs.OPEN) {
			signalingWs.send(JSON.stringify({ type, message }));
		}
	}

	static #OnTrack(event) {
		screenshare.srcObject = event.streams[0];
		screenshare.play().catch(() => {});
		if (tunnelFrame) tunnelFrame.style.display = "none";
	}

	static #OnTunnelFrame(buffer) {
		if (webrtcLive || !tunnelFrame) return;
		if (lastTunnelUrl) URL.revokeObjectURL(lastTunnelUrl);
		lastTunnelUrl = URL.createObjectURL(new Blob([buffer], { type: "image/jpeg" }));
		tunnelFrame.src = lastTunnelUrl;
		tunnelFrame.style.display = "block";
	}

	static #SetRemoteControlMode(isInRemoteControlMode) {
		screenshare.hidden = !isInRemoteControlMode;
	}
}

window.addEventListener("onpointerrawupdate" in window ? "pointerrawupdate" : "pointermove", onPointerMove);
window.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointerup", onPointerUp);

window.addEventListener("keydown", onKeyDown); // Could do tabindex=0 but then they can just press tab again - also, this is more reliable, and screenshare is basically the whole screen anyways.
window.addEventListener("keyup", onKeyUp);

window.addEventListener("wheel", onScroll);

if ("onclipboardchange" in navigator.clipboard) {
	navigator.clipboard.addEventListener("clipboardchange", syncClipboard);
	window.addEventListener("focus", syncClipboard);
} /* else {
	setInterval(syncClipboard, 134);
} */

function sendTunnel(type, message) {
	if (tunnelWs?.readyState === WebSocket.OPEN) {
		tunnelWs.send(JSON.stringify({ type, message }));
	}
}

function onPointerMove(event) {
	event.preventDefault();
	const relative = !!document.pointerLockElement;
	const x = relative ? event.movementX : event.clientX;
	const y = relative ? event.movementY : event.clientY;

	if (pointerMovementChannel?.readyState === "open") {
		sharedView.setUint8(0, relative ? 1 : 0);
		if (relative) {
			sharedView.setInt32(1, x, true);
			sharedView.setInt32(5, y, true);
		} else {
			sharedView.setUint32(1, x, true);
			sharedView.setUint32(5, y, true);
		}
		pointerMovementChannel.send(sharedBytes.subarray(0, 9));
		return;
	}

	sendTunnel("input-move", { relative, x, y });
}

function onPointerUp(event) {
	return onPointerButtonEvent(false, event);
};

function onPointerDown(event) {
	return onPointerButtonEvent(true, event);
};

function onKeyUp(event) {
	return onKeyButtonEvent(false, event);
}

function onKeyDown(event) {
	return onKeyButtonEvent(true, event);
}

function onPointerButtonEvent(isDown, event) {
	event.preventDefault();
	if (isDown) triggerImmersiveMode();

	if (pointerClickChannel?.readyState === "open") {
		sharedView.setUint8(0, isDown ? 1 : 0);
		sharedView.setUint8(1, event.button);
		pointerClickChannel.send(sharedBytes.subarray(0, 2));
		return;
	}

	sendTunnel("input-click", { isDown, button: event.button });
}

function onKeyButtonEvent(isDown, event) {
	if (event.repeat) return;
	event.preventDefault();
	if (isDown) triggerImmersiveMode();

	if (!(event.code in codeMap)) {
		console.error(`"${event.code}" does not have a corresponding value in code-map.json`);
		return;
	}

	const key = codeMap[event.code];
	if (keyboardTypeChannel?.readyState === "open") {
		sharedView.setUint8(0, isDown ? 1 : 0);
		sharedView.setUint8(1, key);
		keyboardTypeChannel.send(sharedBytes.subarray(0, 2));
		return;
	}

	sendTunnel("input-key", { isDown, key });
}

function onScroll(event) {
	event.preventDefault();
	if (pointerScrollChannel?.readyState === "open") {
		sharedView.setUint8(0, event.deltaMode);
		sharedView.setFloat32(1, event.deltaX, true);
		sharedView.setFloat32(5, event.deltaY, true);
		sharedView.setFloat32(9, event.deltaZ, true);
		pointerScrollChannel.send(sharedBytes.subarray(0, 13));
		return;
	}

	sendTunnel("input-scroll", {
		deltaMode: event.deltaMode,
		deltaX: event.deltaX,
		deltaY: event.deltaY,
		deltaZ: event.deltaZ
	});
}

async function requestUntilSupported(element, methodName, optionsList) {
	const method = element[methodName]?.bind(element);
	if (typeof(method) !== "function") return;

	for (const options of optionsList) {
		try {
			return await method(options || {});
		} catch (error) {
			if (error.name === "NotSupportedError" || error.name === "SecurityError" || error.name === "InvalidStateError") {
				continue;
			} else {
				console.warn(`${methodName} failed:`, error);
				return;
			}
		}
	}
}

async function triggerImmersiveMode() {
	if (!document.hasFocus()) return;

	syncClipboard(); // maybe add check to see if they have onclipboardchange or not?

	if (!document.pointerLockElement && "requestPointerLock" in Element.prototype) {
		await requestUntilSupported(document.documentElement, "requestPointerLock", [
			{ unadjustedMovement: true },
			{}
		])
	}

	if (document.fullscreenEnabled && !document.fullscreenElement && "requestFullscreen" in Element.prototype) {
		await requestUntilSupported(document.documentElement, "requestFullscreen", [
			{
				navigationUI: "hide",
				keyboardLock: "browser"
			},
			{
				navigationUI: "hide"
			},
			{}
		])
	}

	try { await screenshare.play(); } catch {}
}

async function syncClipboard() {
	if (!document.hasFocus() || typeof(navigator.clipboard?.readText) !== "function") return;

	const currentClipboardValue = await navigator.clipboard.readText();
	if (typeof(currentClipboardValue) === "string" && currentClipboardValue !== lastClipboardValue) {
		lastClipboardValue = currentClipboardValue;
		if (clipboardSyncChannel?.readyState === "open") {
			clipboardSyncChannel.send(currentClipboardValue);
		} else {
			sendTunnel("clipboard-sync", currentClipboardValue);
		}
	}
}