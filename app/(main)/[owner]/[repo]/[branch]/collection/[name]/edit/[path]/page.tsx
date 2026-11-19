"use client";

import { use, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { DocumentTitle, formatRepoBranchTitle } from "@/components/document-title";
import { useConfig } from "@/contexts/config-context";
import { getSchemaByName } from "@/lib/schema";
import { Entry } from "@/components/entry/entry";

export default function Page({
  params
}: {
  params: Promise<{
    owner: string;
    repo: string;
    branch: string;
    name: string;
    path: string;
  }>
}) {
  const resolvedParams = use(params);
  const { config } = useConfig();
  const searchParams = useSearchParams();
  if (!config) throw new Error(`Configuration not found.`);

  const schemaName = decodeURIComponent(resolvedParams.name);
  const schema = useMemo(() => getSchemaByName(config.object, schemaName), [config, schemaName]);
  if (!schema) throw new Error(`Schema not found for ${schemaName}.`);
  const decodedPath = decodeURIComponent(resolvedParams.path);
  const draftIdentity = searchParams.get("draft") || decodedPath;
  const filename = decodedPath.split("/").pop() || decodedPath;
  
  return (
    <>
      <DocumentTitle
        title={formatRepoBranchTitle(`Edit ${filename} | ${schema.label || schema.name}`, config.owner, config.repo, config.branch)}
      />
      <Entry key={draftIdentity} name={schemaName} path={decodedPath} draftIdentity={draftIdentity} />
    </>
  );
}
