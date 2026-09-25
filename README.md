# MAKE SURE TO READ EVERYTHING

# How to use (Chrome — just open the link like a website)
1. [Fork](https://www.github.com/kingdudely/os-in-browser/fork) the main repository. (it is recommended to make it public for unlimited usage)
3. ONLY when you are in your new repository, [go here](/../../actions/workflows/main.yml).
4. Click on <img width="117" height="28" alt="a white button that says 'Run workflow'" src="https://github.com/user-attachments/assets/77d4ff12-b5be-4e1f-9b39-008975e20898" />
, fill in the required inputs, and click on <img width="93" height="28" alt="a green button that says 'Run workflow'" src="https://github.com/user-attachments/assets/dc9da50f-db46-4a2c-8035-1d0c4b8399d9" />.
5. Wait for the URL to popup (**make sure to refresh every <!-- ever --> so often**), and then click it.
6. You're in!

# Note
1. Make sure to update your fork to get the latest updates!
2. In case anything goes wrong, use ChatGPT or Google. If that doesn't work, screenshot the logs and [make an issue](https://www.github.com/kingdudely/os-in-browser/issues/new)!

# Troubleshooting: "Connection to the remote desktop failed"
This is a **WebRTC** session. Signaling goes through the Cloudflare tunnel, but the video/control stream tries to punch UDP through STUN/TURN.

This fork streams the desktop over the **same HTTPS/WebSocket link** as the page (like a normal website). You should not need to disable WARP/VPN just to see the screen.

If it is still white:

1. Wait until the Actions job is **running** and the URL is printed, then open it.
2. Log in, then **click once** on the page.
3. If the job already stopped, run the workflow again (the Mac is gone).

Old upstream issue: Cloudflare WARP broke **WebRTC-only** streaming. Tunnel fallback covers that.
<!-- add a GIF tutorial -->

# Video tutorial
<video src="https://github.com/user-attachments/assets/d235cbc7-4343-4b33-8f5b-5ce0381637c6"></video>
