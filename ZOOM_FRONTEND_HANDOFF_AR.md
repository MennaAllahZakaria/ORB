# تقرير تسليم للفرونت
## تحويل اجتماعات الحصص من Zego إلى Zoom

**التاريخ:** 2026-09-26  
**Backend commit:** `ca8c1e4`  
**الحالة:** تم تطبيق التغيير على Backend ورفعه على فرع `main`.

---

## 1. ملخص التغيير

تم تغيير مزود اجتماعات الحصص من **Zego** إلى **Zoom**.

الفرونت لم يعد يحتاج إلى:

- Zego App ID.
- Zego Token.
- Zego Room Login.
- Zego UI Kit.
- تحويل `-` إلى `_` في Room ID.
- التعامل مع Zego callbacks.

بدلًا من ذلك، الـ Backend ينشئ اجتماع Zoom ويرسل للفرونت رابط الدخول الجاهز.

> المطلوب من الفرونت هو فتح رابط Zoom باستخدام `url_launcher` أو المتصفح/تطبيق Zoom، وليس تشغيل Zego SDK.

---

## 2. الـ API المستخدم لإنشاء الاجتماع

نفس الـ endpoint القديم ما زال مستخدمًا حتى لا يتغير مسار الطلب في الفرونت:

```http
POST /lessons/:lessonId/create-meeting
Authorization: Bearer <JWT_TOKEN>
```

ويُسمح باستدعائه من:

- الطالب صاحب الحصة.
- المدرس المقبول للحصة.

شروط إنشاء الاجتماع ما زالت كما هي:

- الحصة موجودة.
- المستخدم مشارك في الحصة.
- الحصة حالتها `approved`.
- يوجد مدرس مقبول.
- حالة الدفع `paid`.
- الحصة ليست في حالة Refund أو مشكلة تمنع الدخول.

---

## 3. شكل Response الجديد

### Response نجاح عند إنشاء الاجتماع لأول مرة

```json
{
  "status": "success",
  "data": {
    "provider": "zoom",
    "meetingId": "123456789",
    "meetingRoomId": "123456789",
    "joinUrl": "https://us06web.zoom.us/j/123456789?pwd=...",
    "startUrl": "https://us06web.zoom.us/s/123456789?...",
    "password": "abc123xyz",
    "tokens": null
  }
}
```

### Response نجاح عند إعادة طلب نفس الاجتماع

```json
{
  "status": "success",
  "data": {
    "provider": "zoom",
    "meetingId": "123456789",
    "meetingRoomId": "123456789",
    "joinUrl": "https://us06web.zoom.us/j/123456789?pwd=...",
    "startUrl": null,
    "password": "abc123xyz",
    "tokens": null
  }
}
```

### ملاحظات مهمة على الحقول

| الحقل | الاستخدام |
|---|---|
| `provider` | يجب أن تكون قيمته `zoom`. |
| `meetingId` | رقم اجتماع Zoom، للعرض أو التتبع فقط. لا تستخدموه للدخول بدل الرابط. |
| `meetingRoomId` | موجود للتوافق مع الكود القديم، لكنه يساوي Zoom Meeting ID. |
| `joinUrl` | رابط الدخول الأساسي للطالب والمدرس. هذا هو الحقل المطلوب فتحه. |
| `startUrl` | رابط Host للمدرس فقط. غالبًا لا يحتاجه الفرونت لأن المدرس يمكنه الدخول من `joinUrl`. |
| `password` | كلمة مرور الاجتماع إذا احتاجها Zoom. غالبًا تكون موجودة داخل `joinUrl`. |
| `tokens` | أصبحت `null`، ولا يجب استخدامها. |

---

## 4. المطلوب تغييره في الفرونت

### أ. إزالة منطق Zego من شاشة الحصة

أوقفوا استخدام:

```text
zegoTokenForStudent
zegoTokenForTeacher
meetingRoomId كـ Zego room ID
ZegoUIKitPrebuiltCall
ZegoExpressEngine
Zego loginRoom
Zego user ID/token generation
```

ولا تحاولوا إنشاء Token أو Room من الفرونت.

الـ Backend هو المسؤول عن إنشاء اجتماع Zoom وإرجاع الرابط.

### ب. تغيير زر دخول الحصة

المنطق المطلوب:

1. استدعاء:

```http
POST /lessons/:lessonId/create-meeting
```

2. قراءة:

```text
data.joinUrl
```

3. فتح الرابط خارجيًا.

### مثال Flutter

```dart
final response = await api.post(
  '/lessons/$lessonId/create-meeting',
);

final data = response.data['data'];
final joinUrl = data['joinUrl'] as String?;

if (joinUrl == null || joinUrl.isEmpty) {
  throw Exception('Zoom meeting link is missing');
}

final uri = Uri.parse(joinUrl);

if (!await launchUrl(
  uri,
  mode: LaunchMode.externalApplication,
)) {
  throw Exception('Could not open Zoom meeting');
}
```

ويجب إضافة package `url_launcher` إذا لم تكن موجودة:

```yaml
dependencies:
  url_launcher: ^6.3.1
```

> رقم الإصدار يمكن أن يظل حسب إصدار المشروع الحالي؛ المهم استخدام `LaunchMode.externalApplication` لفتح Zoom أو المتصفح.

### ج. عدم منع الدخول بسبب فرق الوقت في الهاتف

الفرونت لا يجب أن يقرر السماح أو منع دخول الحصة بناءً على وقت الجهاز المحلي.

لا تستخدموا شروطًا مثل:

```dart
if (DateTime.now().isBefore(lesson.requestedDate)) {
  // block joining
}
```

ولا تعتمدوا على Clock الهاتف في السماح بالدخول.

الـ Backend هو المسؤول عن صلاحية الحصة والدفع، وZoom هو المسؤول عن فتح الاجتماع.

يمكن إبقاء رسالة معلوماتية للمستخدم، لكن لا تمنعوا الدخول بسبب فرق دقيقة أو اختلاف Timezone في الهاتف.

---

## 5. الفرق بين الطالب والمدرس

### الطالب

يستخدم:

```text
data.joinUrl
```

ولا يستخدم:

```text
data.startUrl
```

### المدرس

يمكنه أيضًا استخدام:

```text
data.joinUrl
```

وفي حالة وجود زر Host خاص يمكنه استخدام:

```text
data.startUrl
```

لكن الأفضل استخدام `joinUrl` للطرفين لتوحيد تجربة الدخول، لأن Zoom يحدد صلاحيات المضيف حسب حساب الاجتماع.

في بعض الردود قد يكون `startUrl` هو `null` للطالب، وهذا مقصود وليس خطأ.

---

## 6. التعامل مع حالات الـ API

### `200 Success`

افتحوا `data.joinUrl`.

### `400 Lesson is not approved yet`

اعرضوا أن الحصة لم تصبح جاهزة بعد.

### `400 No teacher assigned yet`

اعرضوا أن المدرس لم يتم اختياره بعد.

### `400 Lesson is not available`

راجعوا حالة الدفع أو حالة الحصة، ولا تحاولوا فتح Zoom.

### `403 You are not authorized...`

المستخدم ليس الطالب أو المدرس المرتبط بهذه الحصة.

### `404 Lesson not found`

الحصة غير موجودة أو الـ ID غير صحيح.

### `5xx` أو خطأ Zoom

اعرضوا رسالة مؤقتة للمستخدم مع زر إعادة المحاولة.

لا تنشئوا اجتماعًا محليًا ولا تستخدموا Zego كـ fallback تلقائيًا للحصص الجديدة.

---

## 7. منع الضغط المتكرر على زر الدخول

الـ Backend يعيد استخدام نفس اجتماع Zoom إذا كان موجودًا، لكن يجب منع الضغط المتكرر من الواجهة أثناء الطلب.

مثال:

```dart
if (isJoining) return;

setState(() => isJoining = true);

try {
  await joinZoomLesson();
} finally {
  if (mounted) {
    setState(() => isJoining = false);
  }
}
```

يمكن تغيير النص أثناء الطلب إلى:

```text
جاري تجهيز رابط Zoom...
```

---

## 8. تغييرات البيانات في Lesson

أضيفت حقول Backend جديدة:

```json
{
  "meetingProvider": "zoom",
  "zoomMeetingId": "123456789",
  "zoomJoinUrl": "https://...",
  "zoomStartUrl": "https://...",
  "zoomPassword": "..."
}
```

لكن شاشة الحصة لا تحتاج إلى الاعتماد على هذه الحقول مباشرة؛ الأفضل دائمًا استدعاء:

```http
POST /lessons/:lessonId/create-meeting
```

ثم استخدام `data.joinUrl` من الرد.

السبب أن روابط Zoom وبيانات الدخول يجب أن تظل تحت تحكم Backend، كما أن بعض بيانات الـ host لا يجب عرضها للطالب.

---

## 9. حالة الحصة بعد انتهاء Zoom

عند انتهاء اجتماع Zoom، الـ Backend يستقبل Webhook ويحدّث:

```text
meetingStatus = finished
finalCompletionStatus = completed
reviewStatus = waiting_second_party
meetingEndTime = وقت انتهاء الاجتماع
```

لذلك يجب أن تستمر شاشة ما بعد الحصة في إظهار إجراءات:

- تأكيد أن الحصة تمت.
- الإبلاغ عن وجود مشكلة.
- إرسال Review بعد اكتمال الحصة.

لا تحذفوا الحصة مباشرة من قائمة الحصص المكتملة بمجرد انتهاء Zoom.

### مهم

وجود:

```text
finalCompletionStatus = completed
```

لا يعني أن الدفع تم تحريره نهائيًا أو أن المراجعة انتهت. هذا للحفاظ على توافق الفرونت القديم، بينما تدفق التأكيد والمشكلة والدفع يستمر من خلال Backend.

---

## 10. الإشعارات وحالة الاتصال

الـ Backend أصبح يعتمد على Zoom Webhooks في تحديث:

- بداية الاجتماع.
- دخول المشاركين.
- خروج المشاركين.
- انتهاء الاجتماع.

لذلك لا يحتاج الفرونت إلى إرسال Zego callbacks أو محاولة تعديل `meetingStatus` بنفسه.

الفرونت يكتفي بـ:

- عرض زر الدخول.
- فتح `joinUrl`.
- تحديث البيانات عند الرجوع من Zoom أو عند إعادة فتح الشاشة.

يفضل عمل refresh للحصة بعد الرجوع من Zoom:

```text
GET /lessons/:lessonId
```

أو استخدام endpoint تفاصيل الحصة الموجود حاليًا في المشروع.

---

## 11. الحصص القديمة

تم الإبقاء على كود Zego في Backend مؤقتًا حتى لا تتكسر البيانات القديمة.

لكن بالنسبة للفرونت:

- إذا كان الرد يحتوي على `provider: "zoom"`، افتحوا `joinUrl`.
- لا تفترضوا أن وجود `meetingRoomId` يعني أن الاجتماع Zego.
- لا تستخدموا Zego إلا إذا كان لديكم دعم صريح للسجلات القديمة التي لا تحتوي على `provider: "zoom"`.

القاعدة الجديدة:

```dart
if (data['provider'] == 'zoom' && data['joinUrl'] != null) {
  openZoomUrl(data['joinUrl']);
} else {
  // التعامل مع سجل قديم فقط إذا كان المنتج يحتاج ذلك
}
```

لا تجعلوا `meetingRoomId` هو العامل الوحيد لتحديد مزود الاجتماع.

---

## 12. Checklist التنفيذ للفرونت

- [ ] تحديث Model الخاص بالـ meeting لإضافة `provider`, `meetingId`, `joinUrl`, `startUrl`, `password`.
- [ ] جعل الحقول الجديدة nullable للتعامل مع السجلات القديمة.
- [ ] تغيير زر دخول الحصة ليستخدم `POST /lessons/:lessonId/create-meeting`.
- [ ] فتح `data.joinUrl` باستخدام المتصفح أو تطبيق Zoom.
- [ ] حذف تمرير Zego tokens إلى شاشة المكالمة.
- [ ] حذف أو تعطيل Zego SDK من شاشة الحصة الجديدة.
- [ ] عدم استخدام `meetingRoomId` كـ Zego room ID عندما تكون `provider = zoom`.
- [ ] عدم منع الدخول اعتمادًا على وقت الهاتف المحلي.
- [ ] منع الضغط المتكرر أثناء إنشاء الرابط.
- [ ] معالجة أخطاء `400`, `403`, `404`, و`5xx` برسائل مناسبة.
- [ ] عمل refresh للحصة بعد الرجوع من Zoom.
- [ ] عدم حذف الحصة من قائمة المكتملة بمجرد انتهاء الاجتماع.
- [ ] استمرار إظهار تأكيد الإتمام/الإبلاغ عن مشكلة/التقييم.
- [ ] اختبار الطالب والمدرس بحسابين مختلفين.
- [ ] اختبار اجتماع جديد وإعادة فتح نفس الحصة.
- [ ] اختبار Android وiOS والمتصفح في حالة عدم وجود تطبيق Zoom.

---

## 13. سيناريو الاختبار المطلوب

### اختبار الطالب

1. تسجيل الدخول بحساب طالب.
2. فتح حصة مدفوعة ومقبولة.
3. الضغط على دخول الحصة.
4. التأكد من استدعاء endpoint مرة واحدة.
5. التأكد من فتح `joinUrl` في Zoom.
6. العودة للتطبيق والتأكد من عدم إنشاء اجتماع جديد.

### اختبار المدرس

1. تسجيل الدخول بحساب المدرس المقبول.
2. فتح نفس الحصة.
3. الضغط على دخول الحصة.
4. التأكد من فتح `joinUrl`.
5. التأكد أن `startUrl` لا يظهر للطالب.
6. التأكد أن المدرس والطالب يدخلان نفس `meetingId`.

### اختبار انتهاء الحصة

1. دخول الطرفين إلى نفس اجتماع Zoom.
2. إنهاء الاجتماع.
3. تحديث شاشة الحصة.
4. التأكد من ظهور الحصة ضمن الحصص المكتملة/المراجعة.
5. التأكد من ظهور خيارات تأكيد الإتمام أو الإبلاغ عن مشكلة.

---

## الخلاصة التي يمكن إرسالها للفرونت

> تم تغيير اجتماعات ORB من Zego إلى Zoom. نفس endpoint ما زال موجودًا: `POST /lessons/:lessonId/create-meeting`، لكنه يرجع الآن `data.joinUrl` و`data.startUrl` بدل Zego tokens. افتحوا `joinUrl` خارجيًا باستخدام `url_launcher`، ولا تستخدموا Zego SDK أو `zegoTokenForStudent` أو `zegoTokenForTeacher` للحصص الجديدة. لا تعتمدوا على وقت الهاتف في منع الدخول، ولا تعتبروا `meetingRoomId` وحده دليلًا على أن المزود Zego. بعد انتهاء Zoom، ستظل الحصة في تدفق التأكيد والمشكلة والتقييم كالمعتاد.
