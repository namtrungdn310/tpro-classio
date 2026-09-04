import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const studentPage = readFileSync(
  new URL("../src/app/(dashboard)/students/page.tsx", import.meta.url),
  "utf8",
);
const studentSkeleton = readFileSync(
  new URL("../src/components/students/students-route-skeleton.tsx", import.meta.url),
  "utf8",
);
const headerLoadingStatus = readFileSync(
  new URL("../src/components/layout/header-loading-status.tsx", import.meta.url),
  "utf8",
);
const statusPill = readFileSync(
  new URL("../src/components/ui/status-pill.tsx", import.meta.url),
  "utf8",
);

test("student scopes use concise labels and one unassigned-profile action", () => {
  assert.match(studentPage, /label: "Học viên đang học"/);
  assert.match(studentPage, /label: "Học viên chưa xếp lớp"/);
  assert.match(studentPage, /label: "Học viên ngừng học trung tâm"/);
  assert.doesNotMatch(studentPage, /QuickActionFab label=\{view === "unassigned"/);

  const headerActions = studentPage.match(
    /<AddStudentButton label="Thêm hồ sơ"/g,
  );
  assert.equal(headerActions?.length, 1);
});

test("student scope counts reserve a skeleton while the summary is loading", () => {
  assert.match(
    studentPage,
    /isLoading=\{\s*scopeSummaryQuery\.isFetching\s*\|\|\s*classesQuery\.isFetching\s*\|\|\s*studentsQuery\.isFetching\s*\|\|\s*isNavigationPending\s*\}/,
  );
  assert.match(studentPage, /isLoading \? \(/);
  assert.match(studentPage, /h-3\.5 w-5 shrink-0 animate-pulse/);
  assert.match(studentPage, /count !== undefined/);
  assert.match(studentSkeleton, /grid grid-cols-3 gap-1/);
  assert.match(studentSkeleton, /h-3\.5 w-5 shrink-0 rounded bg-gray-200\/90/);
  assert.match(studentSkeleton, /StudentClassDetailSkeleton isAdmin includeScopeTabs/);
  assert.match(studentSkeleton, /includeScopeTabs \? <StudentScopeTabsSkeleton \/> : null/);
});

test("student chrome settles once while each list can load independently", () => {
  assert.match(
    studentPage,
    /const isCoordinatedContentLoading =\s*!user \|\|[\s\S]*?!hasSettledScopeSummary \|\|[\s\S]*?!hasSettledClasses;/,
  );
  assert.doesNotMatch(studentPage, /!hasSettledStudentList/);
  assert.match(studentPage, /if \(isCoordinatedContentLoading\) \{/);
  assert.match(studentPage, /<StudentScopeTabs[\s\S]*?isLoading[\s\S]*?<StudentHeaderLoadingSkeleton/);
  assert.match(studentPage, /<StudentClassSelectionSkeleton includeScopeTabs=\{false\} \/>/);
  assert.match(studentPage, /<StudentProfileScopeSkeleton isAdmin=\{isAdmin\} \/>/);
  assert.match(studentSkeleton, /export function StudentProfileScopeSkeleton/);
  assert.match(studentSkeleton, /includeScopeTabs \? <StudentScopeTabsSkeleton \/> : null/);
  assert.match(studentSkeleton, /type StudentRouteSkeletonVariant = "class-detail" \| "class-selection" \| "profile"/);
  assert.match(studentSkeleton, /variant === "profile" \? \(/);
  assert.match(studentSkeleton, /sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5/);
  assert.match(studentSkeleton, /Array\.from\(\{ length: 10 \}/);
  assert.match(studentPage, /useLayoutEffect\(\(\) => \{[\s\S]*?setWorkspaceStudent\(requestedStudentQuery\.data\)/);
});

test("student refresh status uses the shared dots indicator", () => {
  const studentStatusStart = studentPage.indexOf("function StudentListStatus");
  const studentStatusEnd = studentPage.indexOf("function HiddenStudentValue");
  const studentStatusSource = studentPage.slice(studentStatusStart, studentStatusEnd);
  assert.match(studentPage, /function StudentLoadingStatus\(\{ isRefreshing \}: \{ isRefreshing: boolean \}\)/);
  assert.match(studentPage, /<HeaderLoadingStatus isLoading=\{isRefreshing\} \/>/);
  assert.match(headerLoadingStatus, /<LoadingLabel label=\{label\} \/>/);
  assert.doesNotMatch(studentStatusSource, /animate-spin|LoaderCircle/);
  assert.match(studentPage, /className="flex min-w-0 flex-1 items-center gap-3"/);
  assert.match(studentPage, /<StudentListStatus\s+filteredCount=\{students\.length\}[\s\S]*?totalCount=\{totalStudentCount\}\s+\/>[\s\S]*?<AddStudentButton onClick=\{openCreateForm\} \/>[\s\S]*?<StudentLoadingStatus isRefreshing=\{studentsQuery\.isFetching \|\| isNavigationPending\} \/>/);
  assert.match(headerLoadingStatus, /className="caption-text inline-flex shrink-0 items-center text-gray-500"/);
  assert.doesNotMatch(studentPage, /className="caption-text ml-auto inline-flex shrink-0 items-center text-gray-500"/);

  const classSelection = readFileSync(
    new URL("../src/components/students/class-selection-view.tsx", import.meta.url),
    "utf8",
  );
  assert.match(classSelection, /<LoadingLabel label="Đang tải" \/>/);
  assert.match(classSelection, /<LoadingLabel label="Đang thử lại" \/>/);
  assert.match(classSelection, /className="caption-text inline-flex shrink-0 items-center gap-1\.5 text-gray-500"/);
  assert.doesNotMatch(classSelection, /className="caption-text ml-auto hidden items-center gap-1\.5 text-gray-500 2xl:inline-flex"/);
  assert.doesNotMatch(classSelection, /LoaderCircle/);
  assert.doesNotMatch(classSelection, /isRefreshing \? "animate-spin"/);
});

test("class search distinguishes no match from an empty class", () => {
  assert.match(
    studentPage,
    /const hasSearch = Boolean\(search\.trim\(\) \|\| deferredSearch\.trim\(\)\);/,
  );
  assert.match(
    studentPage,
    /hasSearch && selectedClass\.student_count > 0 \? \([\s\S]*title="Không tìm thấy học viên phù hợp"/,
  );
  assert.match(
    studentPage,
    /description="Thử tìm bằng họ tên, mã học viên, số điện thoại hoặc tên Zalo khác\."/,
  );
  assert.match(studentPage, /title="Lớp chưa có học viên"/);
});

test("future enrollment dates have a compact textual status in every roster layout", () => {
  assert.match(studentPage, /function StudentEnrollmentDate/);
  assert.match(
    studentPage,
    /const isUpcoming = Boolean\(enrollmentDate && enrollmentDate > getTodayInputValue\(\)\)/,
  );
  assert.equal(
    (studentPage.match(/<StudentEnrollmentDate currentClassId=\{currentClassId\} student=\{student\} \/>/g) ?? []).length,
    2,
  );
  assert.match(studentPage, />\s*Sắp học\s*<\/StatusPill>/);
  assert.match(studentPage, /title="Ngày bắt đầu trong tương lai"/);
  assert.match(studentPage, /<StatusPill className="text-xs font-semibold" title="Ngày bắt đầu trong tương lai">/);
  assert.match(statusPill, /border-primary\/20 bg-primary-soft/);
});

test("profile search uses the debounced active state for empty results", () => {
  assert.match(studentPage, /<StudentProfileScope[\s\S]*?hasSearch=\{hasSearch\}/);
  const profileScopeStart = studentPage.indexOf("function StudentProfileScope");
  const profileScopeEnd = studentPage.indexOf("function StudentProfileTable");
  const profileScopeSource = studentPage.slice(profileScopeStart, profileScopeEnd);
  assert.match(profileScopeSource, /title=\{hasSearch \?/);
  assert.match(profileScopeSource, /description=\{hasSearch \?/);
  assert.doesNotMatch(profileScopeSource, /search\.trim\(\)/);
});

test("the enrollment transfer overlay escapes the inert student workspace", () => {
  const transferSlide = studentPage.match(
    /function EnrollmentTransferSlide[\s\S]*?function EnrollmentFeeSection/,
  )?.[0];

  assert.ok(transferSlide, "EnrollmentTransferSlide source should exist");
  assert.match(transferSlide, /return createPortal\(/);
  assert.match(transferSlide, /document\.body/);
});

test("student create, edit, transfer and continuation share explicit session pricing", () => {
  assert.match(studentPage, /function SessionSelector/);
  assert.match(studentPage, /getEnrollmentFeeSuggestion/);
  assert.match(studentPage, /Gợi ý <strong className="font-semibold text-gray-950">/);
  assert.match(studentPage, /selected_slot_ids: enrollmentActionPlan\.targetConfigs/);
  assert.match(studentPage, /Mỗi lớp cần chọn ít nhất một buổi học/);
});

test("enrollment session pricing follows the continuation layout", () => {
  assert.match(
    studentPage,
    /<p className="table-heading-text min-w-0 text-gray-600">Chọn buổi học trong tuần<\/p>/,
  );
  assert.doesNotMatch(
    studentPage,
    /Chọn buổi học trong tuần \(\{slots\.length\} buổi\)/,
  );
  assert.match(
    studentPage,
    /<div className="w-full min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50\/50 p-3">[\s\S]*Chọn buổi học trong tuần[\s\S]*className="mt-2 w-full min-w-0 overflow-hidden"[\s\S]*grid w-full min-w-0 grid-cols-\[repeat\(4,minmax\(0,1fr\)\)\] gap-2/,
  );
  assert.doesNotMatch(
    studentPage,
    /role="group" aria-label="Chọn buổi học trong tuần" className="mt-2 flex flex-wrap/,
  );
  assert.match(studentPage, /h-11 min-w-0 flex-col items-center justify-center gap-0\.5 rounded-md/);
  assert.match(studentPage, /justify-center gap-1 whitespace-nowrap/);
  assert.match(studentPage, /max-w-full whitespace-nowrap text-xs font-normal leading-3\.5/);
  assert.match(studentPage, /xl:grid-cols-\[(?:400px|420px|430px|440px|460px|560px)_minmax\(0,(?:1fr|520px)\)\]/);
  assert.match(
    studentPage,
    /<FormField[\s\S]*?label="Ngày bắt đầu"[\s\S]*?labelId=\{`enrollment-date-/,
  );
  assert.doesNotMatch(studentPage, /Ngày bắt đầu · \$\{enrollment\.class_name\}/);
  assert.match(
    studentPage,
    /<div className="mt-3 flex min-w-0 items-center justify-between gap-2">[\s\S]*Gợi ý <strong className="font-semibold text-gray-950">[\s\S]*Áp dụng gợi ý/,
  );
  assert.doesNotMatch(studentPage, /mt-2 grid grid-cols-\[minmax\(0,1fr\)_auto\] gap-2/);
  assert.match(
    studentPage,
    /form-input-text inline-flex h-8 shrink-0 items-center gap-1\.5 rounded-md border border-gray-200 bg-white px-2\.5 font-medium text-primary/,
  );
  assert.match(studentPage, /Gợi ý <strong className="font-semibold text-gray-950">/);
  assert.doesNotMatch(studentPage, /Dùng học phí lớp/);
  assert.doesNotMatch(studentPage, /onUseClassFee/);
});

test("editing an enrollment persists selected sessions with profile changes", () => {
  assert.match(studentPage, /payload\.selected_slot_ids = billingValues\.selected_slot_ids/);
  assert.match(studentPage, /selected_slot_ids: enrollment\.selected_slot_ids/);
  assert.match(studentPage, /onEnrollmentSlotsChange/);
  assert.match(studentPage, /sortedEnrollments\.map\(\(enrollment\) =>/);
  assert.match(studentPage, /Vui lòng chọn ít nhất một buổi học trước khi lưu/);
  assert.match(studentPage, /if \(sessionSelectionError\) \{/);
});
