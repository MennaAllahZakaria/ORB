# ORB API

باك إند منصة **ORB** التعليمية. يوفّر واجهات REST للمصادقة وإدارة المستخدمين والدروس والمفاوضات والمدفوعات والإشعارات، إضافة إلى مراكز عمليات الإدارة مثل مراجعة المدرسين، النزاعات، التحويلات، سجل التدقيق، والحصص المتنازع عليها.

> هذا المستودع يحتوي على كود الخادم فقط. واجهة الإدارة العربية موجودة في مستودع [ORB-WEB][2]، وتتصل بالخادم عبر عنوان Railway المهيأ لديها.

## نظرة عامة

يعتمد الخادم على Express وMongoDB/Mongoose، ويستخدم JWT للمصادقة. يدعم الأدوار `student` و`teacher` و`admin` و`superAdmin`. يرث `superAdmin` صلاحيات المسارات الإدارية المعتادة، ويقتصر عليه إنشاء وتعديل وحذف حسابات الأدمن وقراءة سجل التدقيق. تُعرّف أوامر التشغيل والاختبار والمهام الإدارية في `package.json`.[1]

| المجال | أمثلة لما يقدمه الخادم |
|---|---|
| المصادقة | تسجيل البريد وكلمة المرور، تسجيل Google، استعادة كلمة المرور، و`GET /auth/me`. |
| التشغيل التعليمي | طلبات الدروس، التفاوض، الإتمام، المراجعة، والحصص المتنازع عليها. |
| الإدارة | اعتماد/رفض المدرسين، إدارة الحالة، الدعم، الإشعارات، التحويلات، والملخص التشغيلي. |
| الحوكمة | دور `superAdmin`، سجل تدقيق للقرارات الحساسة، ومهام ترقية الدور والتحقق منه. |

## المتطلبات والتشغيل المحلي

يتطلب المشروع Node.js وMongoDB. ثبّتي الحزم أولاً، ثم انسخي أسماء المتغيرات من `.env.example` إلى ملف `.env` محلي وأضيفي القيم الخاصة بك. يدعم الخادم أيضاً `config.env` للتوافق مع الإعدادات القديمة، لكن `.env` هو الخيار الموصى به.

```bash
git clone https://github.com/MennaAllahZakaria/ORB.git
cd ORB
npm install
npm run dev
```

| الأمر | الغرض |
|---|---|
| `npm run dev` | تشغيل الخادم محلياً عبر `nodemon`. |
| `npm start` | تشغيل الخادم باستخدام Node.js. |
| `npm run start:prod` | تشغيل إنتاجي مع `NODE_ENV=production`. |
| `npm test` | تشغيل اختبارات Node المضمنة. |
| `npm run promote:super-admin` | ترقية حساب أدمن محدد بواسطة `SUPER_ADMIN_EMAIL`. |
| `npm run verify:super-admin` | التحقق من دور الحساب المحدد. |

## مثال ملف البيئة

> انسخي **الأسماء فقط** إلى `.env` أو متغيرات Railway وأضيفي القيم لديك. لا تضعي أي كلمة مرور أو رابط MongoDB أو API Key داخل GitHub أو في واجهة `ORB-WEB`.

```env
# التشغيل وقاعدة البيانات
NODE_ENV=development
PORT=3000
DB_URI=
JWT_SECRET_KEY=
JWT_EXPIRE_TIME=30d
HASH_PASS=12

# Origins وGoogle OAuth
FRONTEND_URL=
GOOGLE_CLIENT_ID=
ANDROID_CLIENT_ID=
ANDROID_CLIENT_ID_2=
IOS_CLIENT_ID=

# التخزين والإشعارات وغرف الدروس
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
FIREBASE_SERVICE_ACCOUNT=
BREVO_API_KEY=
ZEGO_APP_ID=
ZEGO_SERVER_SECRET=

# المدفوعات والتحويلات
PAYMOB_API_KEY=
PAYMOB_PAYOUTS_BASE=https://payouts.paymobsolutions.com
PAYMOB_PAYOUTS_RECIPIENTS_PATH=/recipients
PAYMOB_PAYOUTS_AUTH_PATH=/auth/tokens
PAYMOB_PAYOUTS_USE_AUTH_TOKEN=false
PAYMOB_PAYOUTS_BEARER=
EASYKASH_SECRET=

# الحماية والعمليات
ENCRYPTION_KEY=
SUPER_ADMIN_EMAIL=
```

| نوع المتغير | أين يوضع | ملاحظة أمنية |
|---|---|---|
| `DB_URI` و`JWT_SECRET_KEY` | خادم ORB أو Railway فقط | لا يُرسلان أبداً إلى المتصفح ولا يبدآن بـ`VITE_`. |
| مفاتيح Cloudinary وFirebase وPaymob وBrevo وZego | خادم ORB أو Railway فقط | اعتبريها أسراراً؛ جدديها فوراً إذا ظهرت في محادثة أو commit. |
| `GOOGLE_CLIENT_ID` | ORB وORB-WEB حسب التدفق | هو معرّف عميل عام، وليس client secret. |
| `SUPER_ADMIN_EMAIL` | مرة واحدة أثناء الترقية | لا يمنح دوراً تلقائياً عند كل تسجيل دخول؛ استخدمي مهمة الترقية المخصصة. |

## مسارات إدارية مهمة

تتطلب المسارات الإدارية رمز JWT صالحاً في ترويسة `Authorization: Bearer <token>`. لا تعتمدي على إخفاء أزرار الواجهة للحماية؛ فالخادم هو طبقة التفويض النهائية.

| الطريقة | المسار | الصلاحية | الاستخدام |
|---|---|---|---|
| `GET` | `/admin/dashboard/summary` | `admin` أو `superAdmin` | مؤشرات التشغيل والطوابير المختصرة. |
| `GET` | `/admin/teachers/pending` | `admin` أو `superAdmin` | طلبات اعتماد المدرسين. |
| `PUT` | `/admin/teachers/verify/:id` | `admin` أو `superAdmin` | اعتماد مدرس بعد مراجعة الشهادة. |
| `PUT` | `/admin/teachers/reject/:id` | `admin` أو `superAdmin` | رفض مدرس مع سبب. |
| `GET` | `/completeLessons/disputedLessons` | `admin` أو `superAdmin` | حصص في `disputed` أو `under_admin_review`. |
| `PUT` | `/completeLessons/:lessonId/adminResolve` | `admin` أو `superAdmin` | حسم حالة الحصة النهائية مع `adminNote`. |
| `GET` | `/audit-logs` | `superAdmin` فقط | البحث في سجل التدقيق والترقيم. |
| `POST` / `PUT` / `DELETE` | `/admin` و`/admin/:id` | `superAdmin` فقط | إدارة حسابات الأدمن. |

## النشر على Railway

أضيفي القيم السابقة من لوحة **Variables** في خدمة ORB على Railway بدلاً من إنشاء ملف أسرار في المستودع. بعد حفظ `DB_URI` جديد أو أي سر، أعيدي النشر ثم راقبي سجل الخدمة للتأكد من نجاح الاتصال. لا تعيدي استخدام رابط اتصال ظهر في محادثة عامة؛ أنشئي كلمة مرور أو مستخدم قاعدة بيانات جديداً أولاً.

## الاختبار

```bash
npm test
node --check index.js
```

يتحقق الاختبار من توافق `superAdmin` مع المسارات الإدارية القائمة وتحميل امتدادات الإدارة الأساسية. يجب إجراء القرارات المالية أو اعتماد المدرسين في بيئة اختبار أو على سجلات مخصصة للاختبار فقط.

## البنية

```text
config/       اتصال MongoDB وإعدادات الخادم
middleware/   المصادقة والتفويض والتحقق وتسجيل التدقيق
models/       نماذج Mongoose، ومنها المستخدم والدروس والمدفوعات
routes/       تعريفات مسارات Express
services/     منطق الأعمال والقرارات التشغيلية
scripts/      مهام إدارية، ومنها ترقية Super Admin
test/         اختبارات Node
index.js      نقطة تشغيل التطبيق
```

## مراجع

[1]: https://github.com/MennaAllahZakaria/ORB/blob/main/package.json "أوامر ORB المعتمدة"
[2]: https://github.com/MennaAllahZakaria/ORB-WEB "واجهة إدارة ORB"
