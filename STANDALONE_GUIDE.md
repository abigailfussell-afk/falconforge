# How to Use FalconForge as a Standalone App

You can now run FalconForge on any device (Phone, Tablet, Desktop) completely offline. Each device will have its own local database.

## Method 1: Local Network (Easiest for testing)
If all devices are on the same WiFi:
1.  Run `npm run dev -- --host` on your computer.
2.  Look for the "Network" URL in the terminal (e.g., `http://192.168.1.X:3000`).
3.  Open that URL on your phone/tablet.
4.  **Install**:
    *   **iOS (Safari)**: Tap Share button -> "Add to Home Screen".
    *   **Android (Chrome)**: Tap Menu (3 dots) -> "Install App".
    *   **Desktop (Chrome/Edge)**: Click the Install icon in the address bar (right side).

## Method 2: GitHub Pages (Permanent & Offline)
Your app is live at:
**[https://abigailfussell-afk.github.io/ftc-team-manager/](https://abigailfussell-afk.github.io/ftc-team-manager/)**

### Steps to Install on Phone:

1.  **Open the Link**: Tap the link above on your phone (use Safari on iPhone, Chrome on Android).
2.  **Add to Home Screen**:
    *   **iPhone (Safari)**:
        1. Tap the **Share** button (box with arrow up) at the bottom.
        2. Scroll down and tap **"Add to Home Screen"**.
        3. Tap **Add**.
    *   **Android (Chrome)**:
        1. Tap the **Menu** (3 dots) at the top right.
        2. Tap **"Install App"** or **"Add to Home Screen"**.
        3. Follow the prompt to install.
3.  **Launch the App**: Look for the robotic "M" icon on your home screen. Open it!

### Why do this?
*   **Full Screen Experience**: It looks and feels like a native app (no browser bar).
*   **Offline Access**: Once installed, you can turn off WiFi/Data and it still works perfectly.
*   **Local Storage**: Every student has their own private database on their phone.

## Features in Standalone Mode
*   **Offline First**: All data (Tasks, Match Plans, Scouting) is saved to the device's internal storage (`IndexedDB`).
*   **No Internet Needed**: Once loaded, it works without wifi.
*   **Persistent**: Closing the app does not lose data.

To reset data on a device, verify you have a "Delete" or "Reset" button in settings, or clear the browser's site data.
