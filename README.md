# 🌟 ORB - Online Educational Platform Backend

ORB is a robust, scalable, and feature-rich backend system designed for an online educational platform. It facilitates seamless interaction between students and teachers, featuring real-time negotiations, secure payments, automated lesson management, and a comprehensive notification system.

---

## 🚀 Key Features

### 🎓 Lesson Management
- **Request System**: Students can post lesson requests for specific subjects.
- **Teacher Matching**: Teachers can express interest and negotiate prices.
- **Automated Scheduling**: Integration with ZegoCloud for virtual classrooms.
- **Completion Tracking**: Automated Cron jobs to handle lesson start/end and missed sessions.

### 💬 Negotiation & Real-time Interaction
- **Dynamic Pricing**: Counter-offer system between students and teachers.
- **Thread Management**: Organized negotiation threads for each lesson request.
- **Socket.io Integration**: Real-time updates for messages and offers.

### 💳 Financial System
- **Secure Payments**: Integration with **EasyKash** for student payments.
- **Teacher Wallet**: Ledger-based balance tracking with credit/debit history.
- **Payout Management**: Automated and manual payout requests for teachers.
- **Dispute Resolution**: Admin-mediated dispute handling for failed or problematic lessons.

### 🔔 Smart Notifications
- **Multi-channel**: Push notifications (Firebase Cloud Messaging) and Email (Nodemailer).
- **Bilingual Support**: All communications support both **Arabic** and **English**.
- **Contextual Alerts**: Real-time alerts for new offers, payment status, lesson reminders, and points earned.

### 🏆 Gamification
- **Points System**: Users earn points for completing lessons and writing reviews.
- **Leveling**: Automated user leveling (Bronze, Silver, Gold, Platinum) based on points.

---

## 🛠️ Tech Stack

- **Runtime**: [Node.js](https://nodejs.org/)
- **Framework**: [Express.js](https://expressjs.com/)
- **Database**: [MongoDB](https://www.mongodb.com/) with [Mongoose](https://mongoosejs.com/)
- **Real-time**: [Socket.io](https://socket.io/)
- **Authentication**: [JWT (JSON Web Tokens)](https://jwt.io/) & [Bcrypt](https://github.com/kelektiv/node.bcrypt.js)
- **Notifications**: [Firebase Admin SDK](https://firebase.google.com/docs/admin) & [Nodemailer](https://nodemailer.com/)
- **Cloud Storage**: [Cloudinary](https://cloudinary.com/) (for profile images and uploads)
- **Scheduled Tasks**: [Node-cron](https://github.com/node-cron/node-cron)

---

## 📂 Project Structure

```bash
ORB/
├── config/             # Database and Socket configurations
├── corn/               # Automated Cron jobs (Reminders, Completion)
├── fireBase/           # Firebase Admin initialization
├── middleware/         # Auth, Error handling, and Validation middlewares
├── models/             # Mongoose Schemas (User, Lesson, Payment, etc.)
├── routes/             # API Route definitions
├── services/           # Business logic and Controller handlers
├── utils/              # Helper functions (FCM, Email, Validators)
├── uploads/            # Static assets
└── index.js            # Entry point
```

---

## ⚙️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/MennaAllahZakaria/ORB.git
   cd ORB
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Variables:**
   Create a `config.env` file in the root directory and add the following:
   ```env
   PORT=8000
   NODE_ENV=development
   DB_URI=your_mongodb_uri
   JWT_SECRET=your_jwt_secret
   JWT_EXPIRE_TIME=90d
   
   # EasyKash
   EASYKASH_API_KEY=your_key
   
   # Cloudinary
   CLOUDINARY_CLOUD_NAME=name
   CLOUDINARY_API_KEY=key
   CLOUDINARY_API_SECRET=secret
   
   # Email
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=465
   EMAIL_USER=your_email
   EMAIL_PASS=your_app_password
   ```

4. **Run the application:**
   ```bash
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

---

## 🛣️ API Endpoints (Quick Overview)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/auth/signup` | User registration |
| `POST` | `/auth/login` | User login |
| `GET` | `/lessons` | List available lesson requests |
| `POST` | `/negotiations/lessons/:id/thread` | Start/Get negotiation thread |
| `GET` | `/teachers/me/balance` | Get teacher wallet balance |
| `POST` | `/payments` | Initiate lesson payment |
| `GET` | `/notifications/all` | Get user notifications |

---

## 🤝 Contributing

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📜 License

Distributed under the ISC License.

---
Developed with ❤️ by [MennaAllahZakaria](https://github.com/MennaAllahZakaria)
