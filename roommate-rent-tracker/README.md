# 🏠 Roommate Rent & Light Bill Tracker (with In-Website Payment)

A modern, mobile-friendly web app designed for flatmates to track monthly room rent, electricity (light) bills, Wi-Fi / other expenses, calculate per-person shares, and **make payments directly on the website** with instant digital rent receipts.

---

## 💳 In-Website Payment Features

Roommates can click **"Pay ₹X Online"** directly on their card to complete payment on the website:

1. **⚡ Method 1: Instant UPI (0% Fee - Recommended for Flatmates)**
   - **Mobile 1-Tap Pay**: One-tap buttons for **Google Pay**, **PhonePe**, and **Paytm** that open the app directly with the prefilled amount and recipient.
   - **Dynamic QR Code**: Scannable with any UPI app on PC or tablet.
   - **Submit Payment Confirmation**: The roommate enters their 12-digit UTR / UPI reference ID directly on the website.
   - **Instant Verification**: Records the payment on the site with confetti animation 🎉 and marks the roommate as `✅ Paid`.
   - **Send Proof via WhatsApp**: Roommates can click one button to send the receipt and UTR directly to the admin's WhatsApp number.

2. **💳 Method 2: Online Payment Gateway (Razorpay Checkout)**
   - Pay using **Credit/Debit Cards, NetBanking, UPI, and Wallets** directly on the website.
   - Integrated with Razorpay standard checkout popup.
   - Automatic instant verification callback that marks the roommate as `Paid` upon success.
   - User can enter their own free Razorpay Key ID in the Admin Panel (or simulate in test mode).

3. **🧾 Digital Rent Receipt Generator**
   - Automatically generates a clean, printable **Payment Receipt**:
     - Receipt Number
     - Roommate Name & Flat Details
     - Amount Paid & Billing Month
     - Payment Method & UTR / Transaction ID
     - Timestamp & Official "PAID IN FULL" green stamp
   - Printable or downloadable as PDF.

---

## 🔒 Admin Features (Default PIN: 1234)

- **Edit Monthly Bills**:
  - Room Rent (₹)
  - Light Bill (₹) — direct input or meter unit calculator `(Current - Previous) × Rate`
  - Extra shared expenses (Wi-Fi, maid, gas, water)
- **Payment Configuration**:
  - Set your UPI ID (e.g. `kalpesh@okhdfcbank`)
  - Set your WhatsApp phone number to receive payment proofs
  - Set Razorpay Key ID (optional for online card payments)
  - Change Admin PIN
- **Roommate Management**:
  - Add or remove roommates
  - View submitted UTR transaction numbers
  - Toggle payment status manually if someone pays by cash

---

## 🚀 How to Host on Free Platforms (Under 2 Minutes)

### 🌟 Option 1: Netlify Drop (Easiest — No install / No Git required)
1. Open **[app.netlify.com/drop](https://app.netlify.com/drop)** in your browser.
2. Sign in or continue with a free account.
3. Drag and drop the `roommate-rent-tracker` folder directly into the web page.
4. Netlify will publish it immediately and give you a free link like `https://flat-rent-tracker.netlify.app`.

### 🌟 Option 2: Vercel
1. Go to **[vercel.com](https://vercel.com)** and create a free account.
2. Import the folder or GitHub repository and click **Deploy**.
3. Live instantly with a `https://your-room.vercel.app` domain.

### 🌟 Option 3: GitHub Pages
1. Create a repository on [github.com/new](https://github.com/new).
2. Upload `index.html`, `app.js`, and `styles.css`.
3. Go to **Settings > Pages**, choose `main` branch, and click **Save**.

---

## 🔑 Default Credentials
- **Admin PIN**: `1234`
