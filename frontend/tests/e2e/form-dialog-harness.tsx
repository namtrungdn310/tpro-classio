import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  FormDialogBody,
  FormDialogFooter,
  FormDialogShell,
} from "@/components/ui/form-dialog-shell";
import { FormSection } from "@/components/ui/form-section";
import { FormField } from "@/components/ui/form-field";
import { SaveButton } from "@/components/ui/save-button";

declare global {
  interface Window {
    __formDialogTest?: {
      typeValue: (text: string) => void;
      getState: () => {
        open: boolean;
        value: string;
        dirty: boolean;
        confirmVisible: boolean;
      };
    };
  }
}

function Harness() {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("");

  const getState = useCallback(() => {
    const bodyText = document.body.textContent ?? "";
    return {
      open,
      value,
      dirty: value.length > 0,
      confirmVisible:
        bodyText.includes("Thay đổi chưa được lưu") &&
        bodyText.includes("Rời khỏi") &&
        bodyText.includes("Ở lại"),
    };
  }, [open, value]);

  useEffect(() => {
    window.__formDialogTest = {
      typeValue: (text) => setValue(text),
      getState,
    };
  }, [getState]);

  if (!open) {
    return null;
  }

  return (
    <StrictMode>
      <FormDialogShell
        title="Harness form"
        width="md"
        dirty={value.length > 0}
        onClose={() => setOpen(false)}
      >
        <form noValidate className="flex min-h-0 flex-1 flex-col">
          <FormDialogBody>
            <FormSection label="Thông tin">
              <FormField controlId="h-name" label="Họ tên">
                <input
                  id="h-name"
                  data-dialog-autofocus
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  className="form-input-text h-8 w-full rounded-md border border-gray-200 bg-white px-3 outline-none"
                />
              </FormField>
            </FormSection>
          </FormDialogBody>
          <FormDialogFooter
            right={
              <>
                <button
                  type="button"
                  className="h-8 rounded-md border border-gray-200 px-3 text-sm"
                  onClick={() => setOpen(false)}
                >
                  Huỷ
                </button>
                <SaveButton type="submit" isSaving={false} />
              </>
            }
          />
        </form>
      </FormDialogShell>
    </StrictMode>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
