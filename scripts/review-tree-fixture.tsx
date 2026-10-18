import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/fonts/fonts.css";
import "../src/styles.css";
import { ReviewDialog } from "../src/components/ReviewDialog.tsx";
import { MachineContext } from "../src/lib/machineContext.tsx";
import { SettingsProvider } from "../src/lib/settings.ts";

interface Review { paneId: string; directory: string }
declare global { interface Window { reviewTreeQA: { open: (paneId: string, directory: string) => void; close: () => void } } }

/** The Review dialog alone, wired as App.tsx opens it for a pane (scripts/review-tree-browser-qa.ts drives it). */
function Fixture() {
  const [review, setReview] = useState<Review | null>(null);
  window.reviewTreeQA = { open: (paneId, directory) => setReview({ paneId, directory }), close: () => setReview(null) };
  return <main>
    {review && <MachineContext.Provider value="local">
      <ReviewDialog paneId={review.paneId} directory={review.directory} onClose={() => setReview(null)} />
    </MachineContext.Provider>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><SettingsProvider><Fixture /></SettingsProvider></React.StrictMode>);
