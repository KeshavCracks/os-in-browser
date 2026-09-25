const nativeApis = require("native-apis");
const { clipboard } = require("electron"); // navigator.clipboard requires document focus, and electron 44.0.0 removed the clipboard module in the renderer. Really gotta put clipboard read and write in native-apis module instead. . .

const stream = await navigator.mediaDevices.getDisplayMedia({
	video: true,
	audio: { // true
		suppressLocalAudioPlayback: false
	}
});

const tracks = stream.getTracks();

export default class ServerPeer extends RTCPeerConnection {
	static #Init = {
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

	static #CurrentConnection = null;

	signalingWs = null;
	#remoteDescriptionReady = Promise.withResolvers();

	constructor(signalingWs) {
		super(ServerPeer.#Init);

		ServerPeer.#CurrentConnection?.close();
		ServerPeer.#CurrentConnection = this;

		this.signalingWs = signalingWs;

		const pingInterval = setInterval(
			() => this.#sendWSMessage("ping"),
			1337
		);

		this.signalingWs.addEventListener(
			"close",
			() => clearInterval(pingInterval)
		);

		this.signalingWs.addEventListener(
			"message",
			this.#onTrickleICEMessage.bind(this)
		);

		this.addEventListener(
			"icecandidate",
			this.#onIceCandidate.bind(this)
		);

		this.addEventListener(
			"connectionstatechange",
			this.#onConnectionStateChange.bind(this)
		);

		this.#initializeDataChannels();

		tracks.forEach((track) => this.addTrack(track, stream));
		this.#startTunnelFrames();
	}

	#initializeDataChannels() {
		this.#newDataChannel(
			"pointer-movement",
			{
				ordered: false,
				maxRetransmits: 0,
				negotiated: true,
				id: 0
			},
			ServerPeer.#OnPointerMove.bind(ServerPeer)
		);

		this.#newDataChannel(
			"pointer-click",
			{
				ordered: true,
				negotiated: true,
				id: 1
			},
			ServerPeer.#OnPointerClick.bind(ServerPeer)
		);

		this.#newDataChannel(
			"pointer-scroll",
			{
				ordered: false,
				maxRetransmits: 0,
				negotiated: true,
				id: 2
			},
			ServerPeer.#OnPointerScroll.bind(ServerPeer)
		);

		this.#newDataChannel(
			"keyboard-type",
			{
				ordered: true,
				negotiated: true,
				id: 3
			},
			ServerPeer.#OnKeyboardType.bind(ServerPeer)
		);

		const clipboardSyncChannel = this.#newDataChannel(
			"clipboard-sync",
			{
				ordered: true,
				negotiated: true,
				id: 4
			},
			({ data }) => clipboard.writeText(data)
		);

		nativeApis.startClipboardWatch(() => {
			if (clipboardSyncChannel.readyState === "open") {
				clipboardSyncChannel.send(clipboard.readText());
			}
		});
	}

	#newDataChannel(name, options, onMessage) {
		const channel = this.createDataChannel(name, options);

		channel.binaryType = "arraybuffer";
		channel.addEventListener("message", onMessage);

		return channel;
	}

	#onConnectionStateChange() {
		const { connectionState, signalingWs } = this;

		switch (connectionState) {
			case "closed": {
				if (ServerPeer.#CurrentConnection === this) {
					nativeApis.stopClipboardWatch();
					ServerPeer.#CurrentConnection = null;
				}

				break;
			}

			case "failed": {
				if (signalingWs.readyState === signalingWs.OPEN) {
					this.restartIce();
				} else {
					this.close();
				}

				break;
			}

			case "connected":
			case "disconnected":
			case "connecting":
			case "new":
				break;

			default:
				console.warn(
					`Unknown connection state: ${connectionState}`
				);
		}
	}

	async #onTrickleICEMessage({ data }) {
		let message, type;

		try {
			const raw = typeof data === "string" ? data : data.toString();
			if (!raw.startsWith("{")) return;
			({ message, type } = JSON.parse(raw));
		} catch {
			return;
		}

		switch (type) {
			case "input-move": {
				ServerPeer.#ApplyPointerMove(message);
				break;
			}

			case "input-click": {
				ServerPeer.#ApplyPointerClick(message);
				break;
			}

			case "input-key": {
				ServerPeer.#ApplyKeyboard(message);
				break;
			}

			case "input-scroll": {
				ServerPeer.#ApplyScroll(message);
				break;
			}

			case "clipboard-sync": {
				if (typeof message === "string") clipboard.writeText(message);
				break;
			}

			case "offer": {
				try {
					await this.setRemoteDescription(message);

					this.#remoteDescriptionReady.resolve();

					await this.setLocalDescription();

					this.#sendWSMessage(
						"answer",
						this.localDescription
					);
				} catch (error) {
					this.#remoteDescriptionReady.reject(error);

					console.error(
						"Failed to process offer:",
						error
					);
				}

				break;
			}

			case "ice-candidate": {
				try {
					await this.#remoteDescriptionReady.promise;
					await this.addIceCandidate(message);
				} catch (error) {
					console.error(
						"Failed to add ICE candidate:",
						error
					);
				}

				break;
			}

			case "ping":
				break;

			default:
				console.warn(`Unknown packet type: ${type}`);
		}
	}

	#onIceCandidate({ candidate }) {
		if (candidate) {
			this.#sendWSMessage(
				"ice-candidate",
				candidate
			);
		}
	}

	#startTunnelFrames() {
		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;
		video.srcObject = stream;
		video.play().catch(console.error);

		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d", { alpha: false });

		const sendFrame = async () => {
			const { signalingWs } = this;
			if (!signalingWs || signalingWs.readyState !== signalingWs.OPEN) {
				return;
			}

			const vw = video.videoWidth;
			const vh = video.videoHeight;
			if (vw && vh) {
				const width = Math.min(1280, vw);
				const height = Math.round(vh * (width / vw));
				if (canvas.width !== width || canvas.height !== height) {
					canvas.width = width;
					canvas.height = height;
				}
				ctx.drawImage(video, 0, 0, width, height);
				try {
					const blob = await new Promise((resolve) =>
						canvas.toBlob(resolve, "image/jpeg", 0.5)
					);
					if (blob && signalingWs.readyState === signalingWs.OPEN) {
						signalingWs.send(await blob.arrayBuffer());
					}
				} catch (error) {
					console.warn("Tunnel frame failed:", error);
				}
			}

			const delay = this.connectionState === "connected" ? 400 : 90;
			setTimeout(sendFrame, delay);
		};

		setTimeout(sendFrame, 250);
	}

	#sendWSMessage(type, message) {
		const { signalingWs } = this;

		if (signalingWs.readyState === signalingWs.OPEN) {
			signalingWs.send(
				JSON.stringify({
					type,
					message
				})
			);
		}
	}

	static #ApplyPointerMove({ relative, x, y }) {
		if (relative) {
			nativeApis.moveMousePosition(x, y);
		} else {
			nativeApis.setMousePosition(x, y);
		}
	}

	static #ApplyPointerClick({ button, isDown }) {
		nativeApis.setMouseButton(button, isDown);
	}

	static #ApplyKeyboard({ key, isDown }) {
		nativeApis.setKeyboardKey(key, isDown);
	}

	static #ApplyScroll({ deltaMode, deltaX, deltaY, deltaZ }) {
		nativeApis.scrollMouse(deltaMode, deltaX, deltaY, deltaZ);
	}

	static #OnPointerMove({ data }) {
		const view = new DataView(data);
		const isRelative = view.getUint8(0) === 1;
		ServerPeer.#ApplyPointerMove({
			relative: isRelative,
			x: isRelative ? view.getInt32(1, true) : view.getUint32(1, true),
			y: isRelative ? view.getInt32(5, true) : view.getUint32(5, true)
		});
	}

	static #OnPointerClick({ data }) {
		const view = new DataView(data);
		ServerPeer.#ApplyPointerClick({
			isDown: view.getUint8(0) === 1,
			button: view.getUint8(1)
		});
	}

	static #OnKeyboardType({ data }) {
		const view = new DataView(data);
		ServerPeer.#ApplyKeyboard({
			isDown: view.getUint8(0) === 1,
			key: view.getUint8(1)
		});
	}

	static #OnPointerScroll({ data }) {
		const view = new DataView(data);
		ServerPeer.#ApplyScroll({
			deltaMode: view.getUint8(0),
			deltaX: view.getFloat32(1, true),
			deltaY: view.getFloat32(5, true),
			deltaZ: view.getFloat32(9, true)
		});
	}
}