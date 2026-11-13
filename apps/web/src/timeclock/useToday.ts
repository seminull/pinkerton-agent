import { useEffect, useState } from "react";
import { formatDay } from "./format";

// Today's date as YYYY-MM-DD, re-checked every half minute so anything keyed
// on "today" rolls over at midnight on a page left open overnight. State only
// changes when the date does, so the check itself costs no re-render.
export const useToday = (): string => {
  const [today, setToday] = useState(() => formatDay(new Date()));
  useEffect(() => {
    const timer = setInterval(() => setToday(formatDay(new Date())), 30_000);
    return () => clearInterval(timer);
  }, []);
  return today;
};
