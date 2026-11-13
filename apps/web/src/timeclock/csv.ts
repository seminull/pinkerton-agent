import type { TimeEntry } from "../api/types";
import { entryMinutes, formatClockTime, formatDay } from "./format";

const csvCell = (value: string | number | null): string =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

/** Builds the Excel-friendly CSV of the given entries and triggers a download. */
export const downloadCsv = (entries: TimeEntry[]): void => {
  const rows: (string | number | null)[][] = [
    [
      "Date",
      "Start",
      "End",
      "Minutes",
      "Hours",
      "Category",
      "Task",
      "File Reference",
      "Work Type",
      "Notes",
    ],
    ...entries.map((entry) => {
      const minutes = entryMinutes(entry);
      return [
        formatDay(new Date(entry.startedAt)),
        formatClockTime(entry.startedAt),
        entry.endedAt ? formatClockTime(entry.endedAt) : "",
        minutes,
        (minutes / 60).toFixed(2),
        entry.category,
        entry.task,
        entry.reference,
        entry.workType,
        entry.notes,
      ];
    }),
  ];
  // The leading BOM is what makes Excel read the file as UTF-8; without it an
  // accented character or a dash in a task name comes out as mojibake.
  const blob = new Blob(["﻿" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Time_Clock_${formatDay(new Date())}.csv`;
  link.click();
  // Released after a beat: revoking in the same tick can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
