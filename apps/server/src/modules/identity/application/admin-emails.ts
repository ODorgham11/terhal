// The emails admins receive. Plain text, Arabic first then English in the same message, like the staff emails, since we
// don't know which the reader prefers. Times are shown in Cairo time, where the company works.

const formatTime = (date: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(date);

const bilingual = (arabic: string[], english: string[]) =>
  [...arabic, "", "—", "", ...english].join("\n");

export const adminInvitationEmail = (link: string, expiresAt: Date) => ({
  subject: "دعوة للانضمام إلى ترحال كمسؤول | You're invited to join Terhal as an admin",
  text: bilingual(
    [
      "تمت دعوتك للانضمام إلى ترحال كمسؤول.",
      "",
      `أنشئ حسابك من هنا: ${link}`,
      "",
      `يمكن استخدام هذا الرابط مرة واحدة فقط، وتنتهي صلاحيته في ${formatTime(expiresAt, "ar-EG")} بتوقيت القاهرة. إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة.`,
    ],
    [
      "You've been invited to join Terhal as an admin.",
      "",
      `Create your account here: ${link}`,
      "",
      `This link can only be used once and expires on ${formatTime(expiresAt, "en-GB")}, Cairo time. If you weren't expecting this invitation, you can ignore this email.`,
    ],
  ),
});

export const adminPasswordResetEmail = (link: string) => ({
  subject: "إعادة تعيين كلمة المرور | Reset your Terhal admin password",
  text: bilingual(
    [
      "طلب أحدهم إعادة تعيين كلمة المرور لحسابك كمسؤول في ترحال.",
      "",
      `اختر كلمة مرور جديدة من هنا: ${link}`,
      "",
      "ستحتاج أيضًا إلى رمز من تطبيق المصادقة. يمكن استخدام هذا الرابط مرة واحدة فقط، وتنتهي صلاحيته بعد 15 دقيقة. سيتم تسجيل خروجك من جميع أجهزتك. إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة وستبقى كلمة المرور كما هي.",
    ],
    [
      "Someone asked to reset the password of your Terhal admin account.",
      "",
      `Choose a new password here: ${link}`,
      "",
      "You'll also need a code from your authenticator app. This link can only be used once and expires in 15 minutes. You'll be signed out on all your devices. If you didn't ask for this, you can ignore this email and your password stays the same.",
    ],
  ),
});

export const adminTwoFactorResetEmail = (link: string, expiresAt: Date) => ({
  subject: "إعداد تطبيق مصادقة جديد | Set up a new authenticator for Terhal",
  text: bilingual(
    [
      "أعاد مسؤول آخر في ترحال تعيين التحقق بخطوتين لحسابك، وتم تسجيل خروجك من جميع أجهزتك.",
      "",
      `أضف حسابك إلى تطبيق المصادقة من جديد من هنا: ${link}`,
      "",
      `ستحتاج إلى كلمة المرور الخاصة بك. يمكن استخدام هذا الرابط مرة واحدة فقط، وتنتهي صلاحيته في ${formatTime(expiresAt, "ar-EG")} بتوقيت القاهرة. إذا لم تكن تتوقع ذلك، فتواصل مع مسؤول آخر.`,
    ],
    [
      "Another Terhal admin reset the two-factor authentication of your account, and you've been signed out on all your devices.",
      "",
      `Add your account to an authenticator app again here: ${link}`,
      "",
      `You'll need your password. This link can only be used once and expires on ${formatTime(expiresAt, "en-GB")}, Cairo time. If you weren't expecting this, contact another admin.`,
    ],
  ),
});
