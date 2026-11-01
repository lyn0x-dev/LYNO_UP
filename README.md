<div align="center">

# 🤖 LYNO UP

### لوحة استضافة بوتات Node.js — متعددة المستخدمين

لوحة تحكم كاملة بواجهة عصرية داكنة على طراز Pterodactyl Arix، مع بوت تحكم من تيليجرام.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)
![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white)
![RTL](https://img.shields.io/badge/UI-RTL%20Arabic-orange)
![Build](https://img.shields.io/badge/Build%20step-none-brightgreen)

[المميزات](#-المميزات) •
[التثبيت السريع](#-التثبيت-السريع) •
[الإعدادات](#️-الإعدادات-env) •
[تيليجرام](#-بوت-تيليجرام) •
[API](#-api) •
[الأمان](#️-الأمان)

</div>

---

## 📌 نبذة سريعة

**LYNO UP** بتخليك تستضيف بوتات Node.js لنفسك أو لناس تانية من لوحة واحدة: كل مستخدم له حسابه وسيرفراته المعزولة، والأدمن يدير الكل. من غير build ومن غير إعدادات معقدة — `npm install` ثم `npm start`.

---

## ✨ المميزات

### 🖥️ إدارة السيرفرات
| | |
|---|---|
| 🚀 **تحكم كامل** | تشغيل / إيقاف / إعادة تشغيل / إنهاء قسري مع حالات مباشرة |
| ⌨️ **كونسول تفاعلي** | الأوامر بتتبعت فعلياً لـ stdin بتاع السيرفر، واللوجات مباشرة عبر WebSocket |
| ♻️ **إعادة تشغيل تلقائي** | عند الانهيار مع backoff تصاعدي وعدّاد محاولات لكل سيرفر |
| 📊 **قياسات حقيقية** | CPU والذاكرة لكل سيرفر (شجرة العمليات كاملة) + شبكة النظام |
| ⚙️ **متغيرات البيئة** | Environment Variables مستقلة لكل سيرفر |
| 📚 **تنصيب المكتبات** | `npm install` من `package.json` أو مكتبات محددة، والمخرجات تظهر في الكونسول |

### 📁 مدير الملفات
- إنشاء مجلد/ملف، تعديل، إعادة تسمية، حذف
- رفع بالسحب والإفلات (Drag & Drop)
- تنزيل أي ملف، أو مجلد كامل كـ `.zip` لحظياً
- **ضغط** ملفات/مجلدات في `.zip`
- **فك ضغط** أرشيفات `.zip` بأمان (ضد zip-slip و zip-bomb)

### 👥 المستخدمون والصلاحيات
- 🛠️ لوحة إدارة: إنشاء / تعديل / إيقاف / حذف + تحديد الدور والحد الأقصى للسيرفرات
- 🎲 **بيانات عشوائية تلقائية**: أنشئ حساب بدون يوزر/باسورد والنظام يولّدهم ويعرضهم مرة واحدة (مع زر تصفير كلمة المرور)
- 🔑 **بيانات دخول لكل سيرفر (Subuser)**: يوزر وباسورد عشوائي (زي `katapumb`)، ومن يدخل بهم يشوف ويشغّل ذلك السيرفر فقط
- 🔗 **روابط مباشرة**: `/?u=username` يفتح تسجيل الدخول باسم المستخدم جاهزاً، و`/?server=id` يفتح السيرفر فوراً بعد الدخول

### 🤖 تيليجرام
- دخول بالأزرار (يوزر ثم باسورد)
- رفع / تنزيل / فك ضغط / ضغط / تشغيل / إيقاف بأزرار مباشرة

### 🎨 الواجهة
- داكنة وحديثة، متجاوبة مع الجوال، RTL عربي
- تعمل تلقائياً على دومين وبورت المنصة (تقرأ `PORT` / `HOST`)
- تعديل الـ CSS/JS/HTML بيظهر فوراً **من غير ريستارت ولا build**

---

## 🚀 التثبيت السريع

```bash
# 1. تثبيت الحزم
npm install

# 2. إعداد البيئة
cp .env.example .env        # على ويندوز: copy .env.example .env
# افتح .env وعدّل ADMIN_USERNAME / ADMIN_PASSWORD

# 3. تشغيل
npm start

# أو وضع التطوير
npm run dev
```

بعد التشغيل افتح `http://localhost:24691` وسجّل الدخول بحساب الأدمن.

> **أول تشغيل:** بيتعمل حساب الأدمن تلقائياً من `.env`. لو `ADMIN_PASSWORD` فاضية هيتولّد باسورد عشوائي ويظهر في لوجات الخادم — انسخه وغيّره من صفحة "حسابي".

> 🔑 **ملاحظة مهمة:** لو `ADMIN_PASSWORD` موجودة في `.env` فهي **المصدر الرسمي** وبتتزامن مع **كل تشغيل**، فمش محتاج تمسح `users.json` لما تغيّرها. لو عايز تغيّر الباسورد من الواجهة باستمرار، سيبها فاضية.

### الإنتاج مع PM2

```bash
npm install -g pm2
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
```

اللوحة بتسمع على `HOST` (افتراضياً `0.0.0.0`) فتكون متاحة على دومين المنصة وأي IP.

---

## ⚙️ الإعدادات (.env)

<details open>
<summary><b>الإعدادات الأساسية</b></summary>

| المتغير | الوصف | الافتراضي |
|---|---|---|
| `PORT` | بورت اللوحة (غالباً تلقائي من المنصة) | `24691` |
| `HOST` | العنوان اللي اللوحة تسمع عليه | `0.0.0.0` |
| `PLATFORM_URL` | رابط الدومين المعروض في اللوحة | `https://lynox.duckdns.org/` |
| `ADMIN_USERNAME` | اسم مستخدم الأدمن الأول | `admin` |
| `ADMIN_PASSWORD` | كلمة مرور الأدمن (تتزامن كل تشغيل) | — |
| `DATA_DIR` | مجلد البيانات (لحفظها خارج الكود) | مجلد المشروع |
| `DISABLE_HTTPS` | `1` لقفل HTTPS على نفس البورت | — |

</details>

<details>
<summary><b>الجلسات والحدود</b></summary>

| المتغير | الوصف | الافتراضي |
|---|---|---|
| `SESSION_SECRET` | مفتاح توقيع الجلسات (لو فارغ يُحفظ في `.session_secret`) | — |
| `SESSION_TTL_HOURS` | مدة صلاحية الجلسة بالساعات | `168` (7 أيام) |
| `MAX_RUNNING_BOTS` | أقصى عدد سيرفرات شغالة معاً | `10` |
| `BOT_MEMORY_MB` | حد ذاكرة كل سيرفر (V8 heap) | `256` |
| `UPLOAD_MAX_MB` | أقصى حجم ملف مرفوع | `50` |
| `MAX_EXTRACT_MB` | أقصى حجم إجمالي بعد فك الضغط | `500` |

</details>

<details>
<summary><b>إعادة التشغيل التلقائي</b></summary>

| المتغير | الوصف | الافتراضي |
|---|---|---|
| `AUTO_RESTART_MAX` | أقصى محاولات متتالية (`0` = تعطيل) | `5` |
| `AUTO_RESTART_BASE_MS` | تأخير أول محاولة (يتضاعف حتى دقيقة) | `1000` |

</details>

<details>
<summary><b>تيليجرام</b></summary>

| المتغير | الوصف | الافتراضي |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | توكن من @BotFather (فاضي = معطّل) | — |
| `TELEGRAM_ALLOWED_IDS` | أرقام تيليجرام المسموحة (فاصلة/مسافة) | الكل |
| `TELEGRAM_API_BASE` | عنوان Telegram API بديل (للاختبار/Bot API محلي) | `https://api.telegram.org` |

</details>

---

## 🤖 بوت تيليجرام

ضع `TELEGRAM_BOT_TOKEN` في `.env` وشغّل اللوحة. كل شيء بالأزرار:

1. ابدأ بـ `/start` أو اضغط **تسجيل الدخول** → يطلب اسم المستخدم ثم كلمة المرور.
2. بعد الدخول: **الحالة • الملفات • السيرفرات • السجلات** + تشغيل / إيقاف / إعادة / إنهاء قسري.
3. داخل الملفات: اضغط مجلد لفتحه، أو ملف لعرض خياراته (تنزيل / ضغط ZIP / فك ضغط / حذف). زر **⬆️ رفع ملف هنا** للرفع.
4. زر **✖️ إلغاء** يظهر أثناء الرفع أو طلب باسورد الأرشيف أو تسجيل الدخول.

> 💡 لتقييد البوت لأشخاص محددين، حط أرقامهم في `TELEGRAM_ALLOWED_IDS`.

---

## 📝 مثال بوت

أنشئ سيرفر جديد وارفع ملف `index.js`:

```javascript
// index.js
const http = require('http');

http.createServer((req, res) => {
  res.end('Hello from my bot!');
}).listen(process.env.PORT || 8080, () => {
  console.log('Bot is running!');
});
```

---

## 📁 هيكل المشروع

```
bot-hosting-panel/
├── index.js / server.js     # نقطة الدخول (بتشغّل src/main.js)
├── package.json
├── .env.example
├── src/
│   ├── config.js            # الإعدادات والحدود
│   ├── main.js              # HTTP/HTTPS + تيليجرام + الإغلاق الآمن
│   ├── app.js               # Express: middleware + routes + أخطاء
│   ├── auth.js              # الجلسات + تشفير كلمات المرور
│   ├── middleware.js        # requireAuth / requireAdmin / صلاحيات السيرفرات
│   ├── store.js             # users.json و bots.json
│   ├── accounts.js          # حسابات السيرفر (Subuser)
│   ├── botManager.js        # التشغيل/الإيقاف + اللوجات + إعادة التشغيل
│   ├── telemetry.js         # CPU / الذاكرة / الشبكة
│   ├── ws.js / wsServer.js  # WebSocket (لوجات + كونسول)
│   ├── uploads.js · tar.js · utils.js · bundle.js
│   └── routes/              # auth · users · bots · files · deps · system
├── lib/
│   ├── telegram.js          # بوت التحكم
│   ├── archive.js           # واجهة فك الضغط
│   └── archive-worker.js    # 7-Zip WASM داخل worker
├── public/
│   ├── index.html
│   ├── css/                 # 01- ... 11-
│   └── js/                  # 01- ... 07-
├── scripts/e2e.js           # الاختبار الشامل
└── bots/ · bots.json · users.json   # بيانات التشغيل (تلقائية)
```

<details>
<summary><b>✏️ عايز تعدّل إيه؟ روح فين؟</b></summary>

| التعديل | الملف |
|---|---|
| الأرقام والحدود | `.env` (أو `src/config.js`) |
| اسم اللوحة | `BRAND_NAME` في `.env` + `<title>` و`SiteConfiguration` في `public/index.html` |
| الألوان والخطوط | `public/css/01-base.css` (قسم `:root`) |
| شاشة الدخول | `public/css/03-auth.css` + `11-auth-premium.css` |
| السايدبار والتوب بار | `public/css/04-layout-topbar.css` |
| كروت السيرفرات والداشبورد | `public/css/05-dashboard-servers.css` |
| صفحة السيرفر / الكونسول / الملفات | `public/css/06-server-view-files.css` |
| الموبايل (Responsive) | `public/css/10-responsive.css` |
| نصوص وأزرار الصفحات | `public/index.html` |
| تسجيل الدخول والتنقل | `public/js/02-auth-navigation.js` |
| قائمة السيرفرات والكونسول | `public/js/03-servers-console.js` |
| مدير الملفات | `public/js/04-file-manager.js` |
| إعدادات السيرفر وبيانات الدخول | `public/js/05-server-settings.js` |
| المستخدمين / النظام / الحساب | `public/js/06-admin.js` |
| التشغيل وإعادة التشغيل التلقائي | `src/botManager.js` |
| صلاحيات الوصول | `src/middleware.js` |
| API جديد | ملف جديد في `src/routes/` وسجّله في `src/app.js` |

> ملفات `public/` بتتجمّع تلقائياً وتتخدم كـ `/style.css` و`/app.js` — عدّل وحدّث الصفحة بدون ريستارت. الترتيب بالأرقام مهم (الأحدث يغلب الأقدم). أما `src/` فيحتاج ريستارت (أو `npm run dev`).

</details>

---

## 🔌 API

كل الـ Endpoints تحت `/api` وتحتاج كوكي الجلسة. علامة 🛡️ = للأدمن فقط.

<details>
<summary><b>المصادقة والمستخدمون</b></summary>

| Method | Endpoint | الوصف |
|---|---|---|
| POST | `/api/auth/login` | تسجيل الدخول |
| POST | `/api/auth/logout` | تسجيل الخروج |
| GET | `/api/auth/me` | حالة المصادقة |
| POST | `/api/auth/password` | تغيير كلمة المرور |
| 🛡️ GET | `/api/users` | قائمة المستخدمين |
| 🛡️ POST | `/api/users` | إنشاء مستخدم (البيانات عشوائية لو فاضية) |
| 🛡️ PUT | `/api/users/:id` | تعديل (دور/حد/باسورد/إيقاف) |
| 🛡️ POST | `/api/users/:id/credentials` | توليد كلمة مرور جديدة |
| 🛡️ DELETE | `/api/users/:id` | حذف مستخدم + سيرفراته |

</details>

<details>
<summary><b>السيرفرات</b></summary>

| Method | Endpoint | الوصف |
|---|---|---|
| GET | `/api/bots` | السيرفرات (بتاعتك، أو الكل للأدمن) |
| POST | `/api/bots` | إنشاء سيرفر |
| GET | `/api/bots/:id` | تفاصيل سيرفر |
| PUT | `/api/bots/:id` | تحديث (حقول مُصرَّحة فقط) |
| DELETE | `/api/bots/:id` | حذف |
| POST | `/api/bots/:id/start` | تشغيل |
| POST | `/api/bots/:id/stop` | إيقاف |
| POST | `/api/bots/:id/restart` | إعادة تشغيل |
| POST | `/api/bots/:id/kill` | إنهاء قسري |
| GET | `/api/bots/:id/logs` | السجلات |
| GET | `/api/bots/:id/credentials` | يوزر السيرفر |
| POST | `/api/bots/:id/credentials` | توليد بيانات دخول جديدة |
| POST | `/api/bots/:id/install` | تنصيب مكتبات npm |

</details>

<details>
<summary><b>الملفات</b></summary>

| Method | Endpoint | الوصف |
|---|---|---|
| GET | `/api/bots/:id/files` | ملفات الجذر |
| GET | `/api/bots/:id/files/*` | قراءة ملف / تصفح مجلد |
| PUT | `/api/bots/:id/files/*` | تعديل ملف |
| DELETE | `/api/bots/:id/files/*` | حذف |
| POST | `/api/bots/:id/upload` | رفع ملف |
| GET | `/api/bots/:id/download/*` | تنزيل ملف (أو مجلد كـ zip) |
| POST | `/api/bots/:id/mkdir` | إنشاء مجلد |
| POST | `/api/bots/:id/newfile` | إنشاء ملف |
| POST | `/api/bots/:id/rename` | إعادة تسمية |
| POST | `/api/bots/:id/archive` | ضغط إلى `.zip` |
| POST | `/api/bots/:id/extract` | فك ضغط `.zip` |

</details>

<details>
<summary><b>النظام</b></summary>

| Method | Endpoint | الوصف |
|---|---|---|
| GET | `/api/system` | معلومات النظام والحدود |
| GET | `/api/platform` | معلومات المنصة (بما فيها `panelUrl`) |

</details>

---

## 🛡️ الأمان

| الحماية | التفاصيل |
|---|---|
| 🔐 **مصادقة إجبارية** | على كل الـ API + WebSocket، جلسة موقّعة HMAC بصلاحية محدودة |
| 🔑 **كلمات المرور** | مشفرة بـ scrypt (salt عشوائي) + منع timing/enumeration |
| 👤 **عزل الملكية** | المستخدم يشوف سيرفراته، الأدمن الكل، والـ subuser سيرفره فقط |
| 🗜️ **فك الضغط الآمن** | منع zip-slip + حد للحجم/عدد الملفات (zip-bomb) |
| 🚦 **Rate Limiting** | 10 محاولات دخول/10 دقائق + 600 طلب API/دقيقة لكل IP |
| 📂 **Path Traversal** | كل المسارات تُتحقق داخل مجلد السيرفر فقط |
| 🧹 **الملفات المرفوعة** | تنظيف الأسماء ومنع الخروج عن المجلد |
| ✅ **Whitelist للتحديث** | مستحيل تغيير `id`/`ownerId` أو إخراج `mainFile` |
| 🧪 **عزل البيئة** | السيرفرات لا ترث أسرار اللوحة (زي `ADMIN_PASSWORD`) |
| 📉 **حدود الموارد** | ذاكرة لكل سيرفر + حد للشغالة + حد للرفع + حد سيرفرات لكل مستخدم |
| 🧱 **Security Headers** | CSP, X-Frame-Options, X-Content-Type-Options… |
| 🛑 **آخر مشرف** | مستحيل تبقى اللوحة بدون مشرف شغال |

> ⚠️ **للإنتاج:** استخدم HTTPS (عبر المنصة)، ولعزل كامل لملفات السيرفرات عن ملفات اللوحة استخدم Containers/Isolation.

---

## 🧪 الاختبار

```bash
npm test
```

يشغّل نسخة مؤقتة ببيانات مؤقتة ويفحص: الدخول، الصلاحيات، الـ WebSocket، الملفات، والأرشيفات.

---

## 📄 الترخيص

[MIT](LICENSE)

<div align="center">

صُنع بـ ❤️ — **LYNO UP**

</div>
