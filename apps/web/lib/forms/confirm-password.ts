import { z } from "zod";

// Adds "Confirm password" to a form whose schema has a password: it must match, and its error shows on the
// confirmation field. The confirmation is the form's own; drop it before sending (`({ confirmPassword, ...json })`).
//
//   const form = useZodForm(withConfirmation(CompleteStaffPasswordReset.omit({ token: true })), ...);
export const withConfirmation = <Shape extends { password: z.ZodType<string> }>(
  schema: z.ZodObject<Shape>,
) =>
  schema.extend({ confirmPassword: z.string() }).refine(
    (values) => {
      const { password, confirmPassword } = values as { password: string; confirmPassword: string };
      return password === confirmPassword;
    },
    {
      path: ["confirmPassword"],
    },
  );
