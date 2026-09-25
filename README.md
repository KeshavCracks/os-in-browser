# MAKE SURE TO READ EVERYTHING

# How to use
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

If you see a white page after clicking OK on screenshare, or `Connection to the remote desktop failed, retrying connection...`:

1. **Turn off Cloudflare WARP** (and any other VPN). This is the most common cause — WARP intercepts/blocks STUN UDP. The same session often works on a phone that is not on WARP.
2. Reload the page after disconnecting WARP.
3. Disable Brave/uBlock shields that block WebRTC for this site.
4. Try another network (mobile hotspot).
5. Pointer-lock errors like `the root document of this element is not valid for pointer lock` are harmless if video still plays; click the page once after connecting.

It working on Android but not on a Linux laptop almost always means a local VPN/firewall on the laptop, not a dead GitHub Actions job.
<!-- add a GIF tutorial -->

# Video tutorial
<video src="https://github.com/user-attachments/assets/d235cbc7-4343-4b33-8f5b-5ce0381637c6"></video>
