from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_time import business_today
from app.core.performance import log_timing
from app.schemas.dashboard import (
    DashboardFeeSummary,
    DashboardOperationsSummary,
    DashboardOverviewResponse,
    DashboardRevenuePoint,
)


_DASHBOARD_METRICS_SQL = text(
    """
    with revenue_months as (
      select generate_series(
        date_trunc('month', cast(:today as date)) - interval '5 months',
        date_trunc('month', cast(:today as date)),
        interval '1 month'
      )::date as month_start
    ),
    revenue_points as (
      select
        to_char(month.month_start, 'YYYY-MM') as period,
        coalesce(sum(payment.amount), 0) as net_collected_amount
      from revenue_months month
      left join public.payments payment
        on payment.payment_date >= month.month_start
       and payment.payment_date < month.month_start + interval '1 month'
      group by month.month_start
    ),
    revenue_trend as (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'period', point.period,
            'net_collected_amount', point.net_collected_amount
          )
          order by point.period
        ),
        '[]'::jsonb
      ) as points
      from revenue_points point
    ),
    fee_summary as (
      select
        coalesce(sum(fee.final_amount), 0) as total_amount,
        coalesce(
          sum(
            case
              when fee.status = 'PAID'
              then coalesce(fee.paid_amount, fee.final_amount)
              else 0
            end
          ),
          0
        ) as gross_collected_amount,
        coalesce(
          sum(
            case
              when fee.status = 'PAID' then coalesce(fee.refunded_amount, 0)
              else 0
            end
          ),
          0
        ) as refunded_amount,
        coalesce(
          sum(
            case
              when fee.status = 'PAID'
              then greatest(
                coalesce(fee.paid_amount, fee.final_amount)
                  - coalesce(fee.refunded_amount, 0),
                0
              )
              else 0
            end
          ),
          0
        ) as net_collected_amount,
        coalesce(
          sum(case when fee.status = 'UNPAID' then fee.final_amount else 0 end),
          0
        ) as outstanding_amount,
        count(*) filter (where fee.status = 'PAID') as paid_record_count,
        count(*) as record_count
      from public.fee_records fee
      where fee.period = :period
    )
    select
      (
        select count(distinct enrollment.student_id)
        from public.enrollments enrollment
        join public.students student on student.id = enrollment.student_id
        join public.classes class_ on class_.id = enrollment.class_id
        where enrollment.status = 'active'
          and enrollment.enrollment_date <= :today
          and student.status = 'active'
          and class_.is_active = true
      ) as active_student_count,
      (
        select count(*)
        from public.classes class_
        where class_.is_active = true
      ) as active_class_count,
      (
        select count(*)
        from public.classes class_
        cross join lateral jsonb_array_elements(
          case
            when jsonb_typeof(class_.schedule) = 'object'
              and jsonb_typeof(class_.schedule -> 'slots') = 'array'
            then class_.schedule -> 'slots'
            else '[]'::jsonb
          end
        ) as schedule_slot(value)
        where class_.is_active = true
          and jsonb_typeof(schedule_slot.value) = 'object'
          and jsonb_typeof(schedule_slot.value -> 'day') = 'string'
          and jsonb_typeof(schedule_slot.value -> 'start') = 'string'
          and jsonb_typeof(schedule_slot.value -> 'end') = 'string'
      ) as weekly_session_count,
      (
        select count(*)
        from public.staff_members staff
        where staff.is_active = true
          and staff.staff_type = 'TEACHER'
      ) as active_teacher_count,
      (
        select count(*)
        from public.staff_members staff
        where staff.is_active = true
          and staff.staff_type = 'ASSISTANT'
      ) as active_assistant_count,
      fee_summary.total_amount,
      fee_summary.gross_collected_amount,
      fee_summary.refunded_amount,
      fee_summary.net_collected_amount,
      fee_summary.outstanding_amount,
      fee_summary.paid_record_count,
      fee_summary.record_count,
      revenue_trend.points as revenue_trend
    from fee_summary
    cross join revenue_trend
    """
)


async def get_dashboard_overview(db: AsyncSession) -> DashboardOverviewResponse:
    """Return operations, current fees and six-month cash flow in one round trip."""

    today = business_today()
    period = _period_key(today)
    with log_timing("dashboard_service.get_dashboard_overview", threshold_ms=50):
        result = await db.execute(
            _DASHBOARD_METRICS_SQL,
            {"today": today, "period": period},
        )
        metrics = result.one()

    return DashboardOverviewResponse(
        summary=DashboardOperationsSummary(
            period=period,
            active_student_count=int(metrics.active_student_count or 0),
            active_class_count=int(metrics.active_class_count or 0),
            weekly_session_count=int(metrics.weekly_session_count or 0),
            active_teacher_count=int(metrics.active_teacher_count or 0),
            active_assistant_count=int(metrics.active_assistant_count or 0),
        ),
        fees=DashboardFeeSummary(
            total_amount=int(metrics.total_amount or 0),
            gross_collected_amount=int(metrics.gross_collected_amount or 0),
            refunded_amount=int(metrics.refunded_amount or 0),
            net_collected_amount=int(metrics.net_collected_amount or 0),
            outstanding_amount=int(metrics.outstanding_amount or 0),
            paid_record_count=int(metrics.paid_record_count or 0),
            record_count=int(metrics.record_count or 0),
        ),
        revenue_trend=[
            DashboardRevenuePoint.model_validate(point)
            for point in (metrics.revenue_trend or [])
        ],
    )


def _period_key(value: date) -> str:
    return value.strftime("%Y-%m")
