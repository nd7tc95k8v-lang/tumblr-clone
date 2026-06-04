import type { Metadata } from "next";
import ForgotPasswordForm from "../../../../components/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot password",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-full flex-col items-center px-3 py-8 md:py-12">
      <ForgotPasswordForm />
    </div>
  );
}
