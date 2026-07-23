const FEES_TABLE_GRID_VIEWER =
  "grid w-full min-w-0 grid-cols-[minmax(125px,1.02fr)_minmax(145px,1fr)_minmax(132px,.96fr)_minmax(150px,1.08fr)_118px_118px_124px]";

const FEES_TABLE_GRID_ADMIN =
  "grid w-full min-w-0 grid-cols-[minmax(125px,1.02fr)_minmax(145px,1fr)_minmax(132px,.96fr)_minmax(150px,1.08fr)_118px_118px_124px_124px]";

export function getFeesTableGridClass({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  if (!isAdmin) {
    return FEES_TABLE_GRID_VIEWER;
  }

  return FEES_TABLE_GRID_ADMIN;
}
