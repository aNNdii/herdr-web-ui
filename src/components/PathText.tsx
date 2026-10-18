import { Fragment } from "react";

import "./PathText.css";

/**
 * A folder path in a narrow row (the Changes list's folder rows), cut as the Review tree cuts its
 * flattened folders (PathText.css): the front segments give way first, each down to its first
 * letter and "…", then the last one at its start. Its text is the path itself, slashes and all.
 */
export function FolderPathText({ path }: { path: string }) {
  return <span className="path-text path-text-folder">
    {path.split("/").map((segment, index, segments) => <Fragment key={index}>
      {index > 0 && <span className="path-text-slash">/</span>}
      {index < segments.length - 1
        ? <span className="path-text-segment">{segment}</span>
        : <StartCut text={segment} />}
    </Fragment>)}
  </span>;
}

/** A file name cut at its start, so its end and extension stay (`…-import-service.test.ts`). Its text is the name. */
export function FileNameText({ name }: { name: string }) {
  return <StartCut text={name} />;
}

function StartCut({ text }: { text: string }) {
  return <span className="path-text path-text-start-cut"><span dir="ltr">{text}</span></span>;
}
