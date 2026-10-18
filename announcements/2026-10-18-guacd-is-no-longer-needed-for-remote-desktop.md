---
title: "guacd is no longer needed for Remote Desktop"
# info, success, warning or critical
severity: info
# When it goes live. A future date waits until then.
date: 2026-10-18T12:00:00Z
# Optional. A date, or how long after date: 12h, 7d, 2w
expires: 4w
# Users who sign up after date only get it when this is true.
newUsers: false
# everyone or admins
audience: admins
# inbox, or popup to also show it as a card on screen when it arrives
display: inbox
# Up to 4 buttons, each with a url or a Termix tab id.
actions:
  - label: Learn more
    url: https://docs.termix.site/plugins/remote-desktop
---

The Remote Desktop plugin now has its own built-in engine for RDP, VNC and Telnet, so you no longer need a guacd container.

If you run one only for Termix, you can remove it. You can still use an external guacd if you want to: turn on Use an external guacd in the Remote Desktop admin settings.
