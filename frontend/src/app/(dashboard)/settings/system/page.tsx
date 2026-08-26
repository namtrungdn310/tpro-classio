"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  RiAlertLine,
  RiArrowLeftLine,
  RiCheckboxCircleLine,
  RiCloudLine,
  RiDatabase2Line,
  RiRefreshLine,
  RiShieldCheckLine,
  RiTimerLine,
  RiWebhookLine,
} from "react-icons/ri";
import { getOpsOverview, disableWorkspacePay2S } from "@/lib/api/ops";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useAuth } from "@/lib/hooks/useAuth";
import { formatCompactDateTime } from "@/lib/utils/format";
import { useToast } from "@/components/providers/toast-provider";
import { LoadingLabel } from "@/components/ui/loading-label";

function statusLabel(status: string) {
  if (status === "connected") return "Pay2S hoạt động";
  if (status === "error") return "Pay2S cần kiểm tra";
  if (status === "disabled") return "Pay2S đang tắt";
  return "Chưa thiết lập";
}

export default function OperationsCenterPage() {
  const { user } = useAuth();
  const notify = useToast();
  const queryClient = useQueryClient();
  const [live, setLive] = useState(true);
  const [pendingWorkspace, setPendingWorkspace] = useState<string | null>(null);
  const overviewQuery = useQuery({
    queryKey: ["ops", "overview"],
    queryFn: getOpsOverview,
    enabled: Boolean(user?.is_owner),
    refetchInterval: live ? 15_000 : false,
    staleTime: 5_000,
  });

  if (!user?.is_owner) return null;

  const overview = overviewQuery.data;
  const reviewCount = overview?.workspaces.reduce((sum, item) => sum + item.review_request_count, 0) ?? 0;
  const quarantineCount = overview?.workspaces.reduce((sum, item) => sum + item.quarantined_count, 0) ?? 0;
  const activeAdmins = overview?.workspaces.reduce((sum, item) => sum + item.active_admin_count, 0) ?? 0;

  async function disablePay2S(workspaceId: string, workspaceName: string) {
    const reason = window.prompt(
      `Lý do tạm tắt Pay2S của ${workspaceName} (ít nhất 8 ký tự):`,
    );
    if (!reason || reason.trim().length < 8) return;
    setPendingWorkspace(workspaceId);
    try {
      const result = await disableWorkspacePay2S(workspaceId, reason.trim());
      notify.success(result.applied ? "Đã tạm tắt Pay2S cho đơn vị." : "Đơn vị này chưa kết nối Pay2S.");
      await queryClient.invalidateQueries({ queryKey: ["ops", "overview"] });
    } catch (error) {
      notify.error(getApiErrorMessage(error, "Không thể cập nhật Pay2S."));
    } finally {
      setPendingWorkspace(null);
    }
  }

  return (
    <div className="scrollbar-hidden h-full min-h-0 overflow-y-auto px-1 pb-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link href="/settings" className="inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-slate-600 hover:text-primary">
                <RiArrowLeftLine aria-hidden="true" /> Cài đặt
              </Link>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-primary">Dev only</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-950">Trung tâm vận hành</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Theo dõi các đơn vị Admin, kết nối Pay2S, giao dịch cần kiểm tra và dấu hiệu bất thường. Dữ liệu học viên không hiển thị tại đây.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${overview?.status === "degraded" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                {overview?.status === "degraded" ? <RiAlertLine aria-hidden="true" /> : <RiCheckboxCircleLine aria-hidden="true" />}
                {overview?.status === "degraded" ? "Đang suy giảm" : "Đang hoạt động"}
              </span>
              <button type="button" onClick={() => setLive((value) => !value)} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                {live ? "Dừng cập nhật tự động" : "Bật cập nhật tự động"}
              </button>
              <button type="button" aria-label="Làm mới trung tâm vận hành" onClick={() => void overviewQuery.refetch()} disabled={overviewQuery.isFetching} className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                <RiRefreshLine className={overviewQuery.isFetching ? "animate-spin" : ""} aria-hidden="true" />
              </button>
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-500" aria-live="polite">
            {overview ? `Cập nhật ${formatCompactDateTime(new Date(overview.generated_at).getTime())}` : overviewQuery.isLoading ? <LoadingLabel label="Đang chuẩn bị dữ liệu" /> : "Chưa có dữ liệu"}
          </p>
        </header>

        {overviewQuery.isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            Không tải được dữ liệu vận hành. {getApiErrorMessage(overviewQuery.error, "Vui lòng kiểm tra máy chủ và thử lại.")}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Chỉ số vận hành">
          <Metric icon={<RiCloudLine />} label="Đơn vị Admin" value={overview?.workspaces.length ?? 0} />
          <Metric icon={<RiShieldCheckLine />} label="Admin đang hoạt động" value={activeAdmins} />
          <Metric icon={<RiTimerLine />} label="Yêu cầu cần kiểm tra" value={reviewCount} tone={reviewCount ? "warn" : "normal"} />
          <Metric icon={<RiWebhookLine />} label="Giao dịch tạm giữ" value={quarantineCount} tone={quarantineCount ? "danger" : "normal"} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div><h2 className="text-base font-bold text-slate-950">Đơn vị và Admin</h2><p className="mt-1 text-xs text-slate-500">Trạng thái tổng hợp của từng đơn vị.</p></div>
              <Link href="/settings" className="text-xs font-semibold text-primary hover:underline">Quản lý Admin</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3 font-semibold">Đơn vị</th><th className="px-5 py-3 font-semibold">Admin</th><th className="px-5 py-3 font-semibold">Pay2S</th><th className="px-5 py-3 font-semibold">Thanh toán</th><th className="px-5 py-3 font-semibold">Hành động</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {overview?.workspaces.map((workspace) => (
                    <tr key={workspace.id} className="hover:bg-slate-50/80">
                      <td className="px-5 py-4"><p className="font-semibold text-slate-900">{workspace.name}</p><p className="mt-1 break-all font-mono text-xs leading-4 text-slate-500">{workspace.id}</p></td>
                      <td className="px-5 py-4 text-slate-700">{workspace.active_admin_count}/{workspace.admin_count}</td>
                      <td className="px-5 py-4"><span className="font-medium text-slate-800">{statusLabel(workspace.provider_status)}</span><span className="mt-1 block text-xs text-slate-500">Kết nối riêng của đơn vị</span>{workspace.provider_last_error ? <span className="mt-1 block max-w-[260px] text-xs leading-4 text-red-700">{workspace.provider_last_error}</span> : null}</td>
                      <td className="px-5 py-4"><span className={workspace.review_request_count ? "font-semibold text-amber-700" : "text-slate-700"}>{workspace.review_request_count} cần xem</span><span className="mt-1 block text-xs text-slate-500">{workspace.open_request_count} đang mở</span></td>
                      <td className="px-5 py-4">{workspace.provider_status === "connected" ? <button type="button" onClick={() => void disablePay2S(workspace.id, workspace.name)} disabled={pendingWorkspace !== null} className="min-h-9 rounded-md border border-amber-300 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60">{pendingWorkspace === workspace.id ? <LoadingLabel label="Đang xử lý" /> : "Tạm tắt Pay2S"}</button> : <span className="text-xs text-slate-400">Không cần</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!overview?.workspaces.length && !overviewQuery.isLoading ? <p className="px-5 py-8 text-center text-sm text-slate-500">Chưa có đơn vị Admin.</p> : null}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4"><h2 className="text-base font-bold text-slate-950">Sự cố cần chú ý</h2><p className="mt-1 text-xs text-slate-500">Các tín hiệu tổng hợp, không tự kết luận nguyên nhân.</p></div>
            <div className="space-y-3 p-5">
              {overview?.incidents.map((incident) => <article key={incident.incident_id} className="rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="flex items-start gap-2"><RiAlertLine className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" /><div><p className="text-sm font-semibold text-amber-950">{incident.title}</p><p className="mt-1 text-xs leading-5 text-amber-900">{incident.summary}</p></div></div></article>)}
              {!overview?.incidents.length ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><RiCheckboxCircleLine className="mr-1 inline" aria-hidden="true" /> Chưa phát hiện tín hiệu bất thường.</div> : null}
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <InfoCard icon={<RiDatabase2Line />} title="Dữ liệu" text="Máy chủ tự kiểm tra trạng thái cần thiết; thông tin kết nối không hiển thị trên giao diện." />
          <InfoCard icon={<RiWebhookLine />} title="Pay2S" text="Giao dịch sai mã, sai số tiền hoặc sai tài khoản sẽ không tự ghi nhận học phí." />
          <InfoCard icon={<RiShieldCheckLine />} title="Bảo mật" text="Chỉ Dev đã xác thực bảo mật mới vào được trang này. Mọi thao tác điều khiển đều phải ghi lý do." />
        </section>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, tone = "normal" }: { icon: React.ReactNode; label: string; value: number; tone?: "normal" | "warn" | "danger" }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">{icon}</span><span className={`text-2xl font-bold tabular-nums ${tone === "danger" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-slate-950"}`}>{value}</span></div><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p></article>;
}

function InfoCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><span className="text-primary">{icon}</span>{title}</div><p className="mt-2 text-xs leading-5 text-slate-600">{text}</p></article>;
}
