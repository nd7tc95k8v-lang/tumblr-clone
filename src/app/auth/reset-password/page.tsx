import type { Metadata } from "next";
import ResetPasswordForm from "../../../../components/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset password",
};

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-full flex-col items-center px-3 py-8 md:py-12">
      <ResetPasswordForm />
    </div>
  );
}
