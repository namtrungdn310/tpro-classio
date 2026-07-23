"use client";

import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { UserRound } from "lucide-react";
import { z } from "zod";
import { useToast } from "@/components/providers/toast-provider";
import { getSettingsRoleLabel } from "@/components/settings/settings-role";
import {
  SettingsCard,
  SettingsField,
} from "@/components/settings/settings-card";
import {
  formTextControlClassName,
  formTextControlErrorClassName,
} from "@/components/ui/form-text-control";
import { SaveButton } from "@/components/ui/save-button";
import { UnsavedChangesNotice } from "@/components/ui/unsaved-changes-notice";
import { updateMyUsername, type UserMe } from "@/lib/api/auth";
import { getApiErrorMessage } from "@/lib/api/errors";
import { authQueryKeys } from "@/lib/auth/query-keys";
import {
  fieldFeedbackAfterBlur,
  fieldFeedbackAfterInput,
  fieldFeedbackAfterSubmit,
  initialFieldFeedback,
  shouldShowFieldError,
} from "@/lib/auth/field-feedback";
import { noSavedInfoFormProps, savedInfoAutocomplete } from "@/lib/forms/saved-info-policy";
import { validationMessages } from "@/lib/forms/validation-messages";
import { useAuth } from "@/lib/hooks/useAuth";
import { cn } from "@/lib/utils";

const accountSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, validationMessages.required("tên đăng nhập"))
    .min(3, validationMessages.usernameLength)
    .max(20, validationMessages.usernameLength)
    .regex(/^[A-Za-z0-9]+$/, validationMessages.usernameCharacters),
});

type AccountFormValues = z.infer<typeof accountSchema>;

export function AccountSettingsSection({ user }: { user: UserMe }) {
  const notify = useToast();
  const queryClient = useQueryClient();
  const { getMeSilently } = useAuth();
  const initialUsername = user.username ?? user.full_name ?? "";
  const [usernameFeedback, setUsernameFeedback] = useState(initialFieldFeedback);
  const {
    formState: { errors, isSubmitted, isSubmitting },
    clearErrors,
    handleSubmit,
    register,
    reset,
    setError,
    watch,
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    shouldFocusError: true,
    defaultValues: { username: initialUsername },
  });

  useEffect(() => {
    reset({ username: initialUsername });
    setUsernameFeedback(initialFieldFeedback);
  }, [initialUsername, reset]);

  async function submit(values: AccountFormValues) {
    setUsernameFeedback(fieldFeedbackAfterSubmit);
    const username = values.username.trim();
    try {
      await updateMyUsername(username);
      await getMeSilently();
      await queryClient.invalidateQueries({ queryKey: authQueryKeys.users });
      reset({ username });
      setUsernameFeedback(initialFieldFeedback);
      notify.success("Đã cập nhật tên đăng nhập.");
    } catch (error) {
      setError("username", {
        type: "server",
        message: getApiErrorMessage(
          error,
          "Không thể cập nhật tên đăng nhập. Vui lòng thử lại.",
        ).replace("Username này đã được dùng", "Tên đăng nhập này đã được sử dụng."),
      });
    }
  }

  const usernameRegistration = register("username");
  const usernameValue = watch("username");
  const hasUsernameChanges = usernameValue.trim() !== initialUsername.trim();
  const usernameValidation = accountSchema.safeParse({ username: usernameValue });
  const hasUsernameValidationError = !usernameValidation.success;
  const currentUsernameValidationError = usernameValidation.success
    ? undefined
    : usernameValidation.error.issues[0]?.message;
  const hasExceededUsernameLength = usernameValue.trim().length > 20;
  const roleLabel = getSettingsRoleLabel(user);
  const usernameErrorMessage = currentUsernameValidationError ?? errors.username?.message;
  const usernameError =
    usernameErrorMessage &&
    (hasExceededUsernameLength || shouldShowFieldError(usernameFeedback, isSubmitted))
      ? usernameErrorMessage
      : undefined;
  const displayName = initialUsername || "Chưa đặt tên";
  const initial = (initialUsername || user.email).trim().charAt(0).toUpperCase() || "T";

  return (
    <SettingsCard title="Tài khoản" icon={<UserRound aria-hidden="true" />}>
      <div className="flex min-w-0 items-center gap-3 border-b border-gray-100 bg-[linear-gradient(135deg,#FAFCFF_0%,#FFFFFF_72%)] px-4 py-4 sm:px-5">
        <span
          className="font-ui inline-flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full border border-gray-200 bg-gray-100 bg-cover bg-center text-sm font-semibold text-gray-800 shadow-sm"
          role={user.avatar_url ? "img" : undefined}
          aria-label={user.avatar_url ? `Ảnh đại diện của ${displayName}` : undefined}
          aria-hidden={user.avatar_url ? undefined : "true"}
          style={
            user.avatar_url
              ? { backgroundImage: `url(${user.avatar_url})` }
              : undefined
          }
        >
          {user.avatar_url ? null : initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="form-input-text min-w-0 break-words text-gray-950">
              {displayName}
            </p>
            <span className="inline-flex shrink-0 select-none rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700">
              {roleLabel}
            </span>
          </div>
          <p className="mt-0.5 select-text break-all text-[13px] leading-5 text-gray-500">
            {user.email}
          </p>
        </div>
      </div>

      <form
        {...noSavedInfoFormProps}
        noValidate
        onSubmit={handleSubmit(submit, () => {
          setUsernameFeedback((current) => fieldFeedbackAfterSubmit(current));
        })}
      >
        <SettingsField
          htmlFor="settings-username"
          label="Tên đăng nhập"
          error={usernameError}
          errorId="settings-username-error"
          action={
            <SaveButton
              type="submit"
              disabled={!hasUsernameChanges}
              isSaving={isSubmitting}
            />
          }
        >
          <input
            {...usernameRegistration}
            id="settings-username"
            autoComplete={savedInfoAutocomplete.disabled}
            enterKeyHint="done"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onInput={(event) => {
              const value = event.currentTarget.value;
              clearErrors("username");
              setUsernameFeedback((current) =>
                fieldFeedbackAfterInput(current, value),
              );
            }}
            onBlur={(event) => {
              setUsernameFeedback(fieldFeedbackAfterBlur);
              void usernameRegistration.onBlur(event);
            }}
            aria-invalid={Boolean(usernameError)}
            aria-describedby={usernameError ? "settings-username-error" : undefined}
            className={cn(
              formTextControlClassName,
              usernameError && formTextControlErrorClassName,
            )}
          />
          <UnsavedChangesNotice
            hasChanges={hasUsernameChanges}
            hasErrors={hasUsernameValidationError || Boolean(usernameError)}
            isSaving={isSubmitting}
            variant="inline"
          />
        </SettingsField>
      </form>
    </SettingsCard>
  );
}
