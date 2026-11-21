import type { Locale } from "@terhal/contracts";

// The emails staff receive, in plain text. A staff member's own emails are in their language. An invitation goes to
// someone without an account yet, whose language we don't know, so it's in both, Arabic first. Times are shown in Cairo
// time, where the company works.

const formatTime = (date: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Africa/Cairo",
  }).format(date);

const bilingual = (arabic: string[], english: string[]) =>
  [...arabic, "", "—", "", ...english].join("\n");

export const staffInvitationEmail = (link: string, expiresAt: Date) => ({
  subject: "دعوة للانضمام إلى فريق ترحال | You're invited to join the Terhal team",
  text: bilingual(
    [
      "تمت دعوتك للانضمام إلى فريق ترحال على لوحة التحكم.",
      "",
      `أنشئ حسابك من هنا: ${link}`,
      "",
      `يمكن استخدام هذا الرابط مرة واحدة فقط، وتنتهي صلاحيته في ${formatTime(expiresAt, "ar-EG")} بتوقيت القاهرة. إذا لم تكن تتوقع هذه الدعوة، يمكنك تجاهل هذه الرسالة.`,
    ],
    [
      "You've been invited to join the Terhal team on the dashboard.",
      "",
      `Create your account here: ${link}`,
      "",
      `This link can only be used once and expires on ${formatTime(expiresAt, "en-GB")}, Cairo time. If you weren't expecting this invitation, you can ignore this email.`,
    ],
  ),
});

export const staffPasswordResetEmail = (link: string, locale: Locale) =>
  locale === "ar"
    ? {
        subject: "إعادة تعيين كلمة المرور في ترحال",
        text: [
          "طلب أحدهم إعادة تعيين كلمة المرور لحسابك في لوحة تحكم ترحال.",
          "",
          `اختر كلمة مرور جديدة من هنا: ${link}`,
          "",
          "يمكن استخدام هذا الرابط مرة واحدة فقط، وتنتهي صلاحيته بعد ساعة. سيتم تسجيل خروجك من جميع أجهزتك. إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة وستبقى كلمة المرور كما هي.",
        ].join("\n"),
      }
    : {
        subject: "Reset your Terhal password",
        text: [
          "Someone asked to reset the password of your Terhal dashboard account.",
          "",
          `Choose a new password here: ${link}`,
          "",
          "This link can only be used once and expires in an hour. You'll be signed out on all your devices. If you didn't ask for this, you can ignore this email and your password stays the same.",
        ].join("\n"),
      };
