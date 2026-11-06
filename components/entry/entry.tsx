"use client";

import { Fragment, useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useConfig } from "@/contexts/config-context";
import { usePublication } from "@/contexts/publication-context";
import { useUser } from "@/contexts/user-context";
import { entryDraftKey, moveEntryDraft } from "@/lib/entry-draft";
import { createEntrySaveQueue, type EntrySaveBase, type EntrySaveResult } from "@/lib/entry-save-queue";
import { parseAndValidateConfig } from "@/lib/config";
import { resolveContentOperations } from "@/lib/operations";
import { requireApiSuccess } from "@/lib/api-client";
import { getSchemaActions } from "@/lib/actions";
import {
  generateFilename,
  getPrimaryField,
  getSchemaByName,
  safeAccess,
} from "@/lib/schema";
import {
  getFileExtension,
  getFileName,
  getParentPath,
  getRelativePath,
  joinPathSegments,
  normalizePath
} from "@/lib/utils/file";
import type { ApiSuccess, EntryData, EntryHistoryItem } from "@/types/api";
import { EntryForm } from "./entry-form";
import { EntryHistoryDropdown } from "./entry-history";
import { EmptyCreate } from "@/components/empty-create";
import { FileOptions } from "@/components/file/file-options";
import { RepoActionButtons } from "@/components/repo/repo-action-buttons";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { useRepoHeader } from "@/components/repo/repo-header-context";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner";
import { EllipsisVertical, History, Lock, LockOpen, Save } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";

type LintView = {
  state: {
    doc: {
      toString(): string;
    };
  };
};

type GroupTrailItem = {
  name: string;
  label?: string | null;
};

type LoadedEntry = EntryData & { readEpoch: number; readDuringSave: boolean };
type EntrySaveRequest = {
  values: Record<string, unknown>;
  editVersion: number;
  filename: string;
  showFilenameField: boolean;
  filenameFieldMode: string;
  filenameUnlocked: boolean;
};

export function Entry({
  name = "",
  path: initialPath,
  parent,
  title,
  headerMeta,
  onSave,
}: {
  name?: string;
  path?: string;
  parent?: string;
  title?: string;
  headerMeta?: ReactNode;
  onSave?: (data: Record<string, unknown>) => void;
}) {
  const [path, setPath] = useState<string | undefined>(initialPath);
  const [draftIdentity] = useState(() => initialPath ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("draft") : null) ?? crypto.randomUUID());
  const [entry, setEntry] = useState<EntryData | null>();
  const [sha, setSha] = useState<string | undefined>();
  const [displayTitle, setDisplayTitle] = useState<string>(() => {
    if (title) return title;
    if (initialPath && initialPath !== ".pages.yml") {
      return `Editing "${getFileName(normalizePath(initialPath))}"`;
    }
    return "Edit";
  });
  const [isLoading, setIsLoading] = useState(path ? true : false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChangesSinceSubmit, setHasChangesSinceSubmit] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [hasRegisteredChanges, setHasRegisteredChanges] = useState(false);
  const [error, setError] = useState<string | undefined | null>(null);
  const changeVersionRef = useRef(0);
  const unsavedRef = useRef(false);
  unsavedRef.current = isFormDirty || hasRegisteredChanges;
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const { mutate } = useSWRConfig();
  const { trackPublication } = usePublication();
  const { user } = useUser();
  const saveHandlersRef = useRef<{
    persist: (request: EntrySaveRequest, base: EntrySaveBase) => Promise<EntrySaveResult>;
    onSaved: (request: EntrySaveRequest, result: EntrySaveResult) => void;
  }>({ persist: async () => { throw new Error("편집기를 준비 중이에요."); }, onSaved() {} });
  const [saveQueue] = useState(() => createEntrySaveQueue<EntrySaveRequest>({
    persist: (request, base) => saveHandlersRef.current.persist(request, base),
    onSaved: (request, result) => saveHandlersRef.current.onSaved(request, result),
    onBusyChange: setIsSaving,
    fingerprint: (request) => JSON.stringify([request.values, request.filename, request.showFilenameField, request.filenameFieldMode, request.filenameUnlocked]),
  }));

  const router = useRouter();
  
  const { config } = useConfig();
  if (!config) throw new Error(`Configuration not found.`);
  
  const schema = useMemo(() => {
    if (!name) return;
    return getSchemaByName(config?.object, name)
  }, [config, name]);
  const schemaType = schema?.type;
  const operations = useMemo(
    () =>
      resolveContentOperations({
        schema,
        scope:
          path === ".pages.yml" || initialPath === ".pages.yml"
            ? "settings"
            : undefined,
      }),
    [initialPath, path, schema],
  );
  const canCreate = operations.create;
  const canRename = operations.rename;
  const canDelete = operations.delete;
  const isFileEditorMode = !schema?.fields || schema.fields.length === 0;
  const filenameFieldMode = useMemo(() => {
    if (!schema || schema.type !== "collection") return "hidden";
    if (schema.filenameField === true) return "enabled";
    if (schema.filenameField === "create") return "create";
    if (schema.filenameField === false) return "hidden";
    return isFileEditorMode ? "enabled" : "hidden";
  }, [isFileEditorMode, schema]);
  const showFilenameField = useMemo(() => {
    if (schemaType !== "collection") return false;
    if (filenameFieldMode === "enabled") return true;
    if (filenameFieldMode === "create") return !path;
    return false;
  }, [filenameFieldMode, path, schemaType]);
  const [filenameValue, setFilenameValue] = useState("");
  const [isFilenameUnlocked, setIsFilenameUnlocked] = useState(false);
  
  const entryFields = useMemo(() => {
    return !schema?.fields || schema.fields.length === 0
      ? [{
          name: "body",
          type: "code",
          label: showFilenameField ? "Content" : false,
          options: {
            format: schema?.extension || (entry?.name && getFileExtension(entry.name)) || "markdown",
            lintFn: path === ".pages.yml"
              ? (view: LintView) => {
                  const {parseErrors, validationErrors} = parseAndValidateConfig(view.state.doc.toString());
                  return [...parseErrors, ...validationErrors];
                }
              : undefined
          }
        }]
      : schema?.list === true
        ? [{
            name: "listWrapper",
            label: false,
            type: "object",
            list: true,
            fields: schema.fields
          }]
        : schema.fields;
  }, [schema, entry, path, showFilenameField]);

  const entryContentObject = useMemo(() => {
    return path
      ? schema?.list === true
        ? { listWrapper: entry?.contentObject }
        : entry?.contentObject
      : schema?.list === true
        ? { listWrapper: [] }
        : {};
  }, [schema, entry, path]);

  useEffect(() => {
    if (!showFilenameField || schemaType !== "collection" || !schema) return;

    if (path) {
      setFilenameValue(getFileName(normalizePath(path)));
      setIsFilenameUnlocked(false);
      return;
    }

    const generated = generateFilename(schema.filename, schema, entryContentObject as Record<string, unknown>);
    setFilenameValue(generated || "untitled");
    setIsFilenameUnlocked(true);
  }, [entryContentObject, path, schema, schemaType, showFilenameField]);

  const entryApiUrl = useMemo(() => (
    path
      ? `/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/entries/${encodeURIComponent(path)}?name=${encodeURIComponent(name)}`
      : null
  ), [config.branch, config.owner, config.repo, name, path]);

  const fetchEntryByUrl = useCallback(async (apiUrl: string): Promise<LoadedEntry> => {
    const readEpoch = saveQueue.epoch;
    const readDuringSave = saveQueue.busy;
    const response = await fetch(apiUrl, { cache: "no-store" });
    const data = await requireApiSuccess<any>(
      response,
      "Failed to fetch entry",
    );
    return { ...data.data, readEpoch, readDuringSave } as LoadedEntry;
  }, [saveQueue]);

  const {
    data: swrEntryData,
    error: swrEntryError,
    isLoading: swrEntryLoading,
    mutate: mutateEntry,
  } = useSWR<LoadedEntry>(
    entryApiUrl ? [entryApiUrl, saveQueue.id] as const : null,
    ([url]) => fetchEntryByUrl(url),
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2000,
    },
  );

  useEffect(() => {
    if (!path) return;
    setIsLoading(swrEntryLoading);
  }, [path, swrEntryLoading]);

  useEffect(() => {
    if (!swrEntryData || !path) return;
    if (unsavedRef.current) return;
    if (swrEntryData.path !== path || !saveQueue.adoptRemote(swrEntryData, swrEntryData.readEpoch, swrEntryData.readDuringSave)) return;
    setEntry(swrEntryData);
    setSha(swrEntryData.sha);
    setHasRegisteredChanges(false);
    setIsLoading(false);
    setError(null);

    if (initialPath && schema && schema.type === "collection") {
      const primaryField = getPrimaryField(schema);
      const primaryValue = primaryField
        ? safeAccess(swrEntryData.contentObject ?? {}, primaryField)
        : undefined;
      const hasPrimaryValue = typeof primaryValue === "string"
        ? primaryValue !== ""
        : primaryValue != null;
      const titleValue = hasPrimaryValue
        ? String(primaryValue)
        : getFileName(normalizePath(path));
      setDisplayTitle(`Editing "${titleValue}"`);
    } else if (!title && path && path !== ".pages.yml") {
      setDisplayTitle(`Editing "${getFileName(normalizePath(path))}"`);
    }
  }, [initialPath, path, saveQueue, schema, swrEntryData, title]);

  useEffect(() => {
    if (!swrEntryError) return;
    const message = swrEntryError instanceof Error ? swrEntryError.message : "Failed to fetch entry.";
    setError(message);
    setIsLoading(false);
  }, [swrEntryError]);

  const historyApiUrl = useMemo(() => (
    path
      ? `/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/entries/${encodeURIComponent(path)}/history?name=${encodeURIComponent(name)}`
      : null
  ), [config.branch, config.owner, config.repo, name, path]);

  const historyKey = useMemo(
    () => historyApiUrl ? [historyApiUrl, sha ?? ""] as const : null,
    [historyApiUrl, sha],
  );

  const fetchEntryHistory = useCallback(async ([apiUrl]: readonly [string, string]): Promise<EntryHistoryItem[]> => {
    const response = await fetch(apiUrl);
    const data = await requireApiSuccess<any>(
      response,
      "Failed to fetch entry's history",
    );
    return data.data as EntryHistoryItem[];
  }, []);

  const { data: historyData } = useSWR<EntryHistoryItem[]>(
    historyKey,
    fetchEntryHistory,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2000,
    },
  );

  const currentFilename = useMemo(
    () => path ? getFileName(normalizePath(path)) : "",
    [path],
  );
  const filenameChanged = showFilenameField
    && filenameValue.trim().length > 0
    && filenameValue.trim() !== currentFilename;

  const editUrlFor = (savedPath: string) => `/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collection/${encodeURIComponent(name)}/edit/${encodeURIComponent(savedPath)}${!initialPath ? `?draft=${encodeURIComponent(draftIdentity)}` : ""}`;

  useEffect(() => {
    if (!initialPath && name) {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("draft")) { url.searchParams.set("draft", draftIdentity); window.history.replaceState(null, "", url); }
    }
  }, [draftIdentity, initialPath, name]);

  const persistEntry = async (request: EntrySaveRequest, base: EntrySaveBase): Promise<EntrySaveResult> => {
    const { values, showFilenameField: showFilename, filenameFieldMode: filenameMode, filenameUnlocked } = request;
    let savePath = base.path;
    const normalizedFilename = normalizePath(request.filename.trim()).split("/").pop() || "";
    if (showFilename && !normalizedFilename) throw new Error("Filename is required.");

    if (!savePath) {
      if (!schema) throw new Error("Cannot create entry without schema.");
      if (!canCreate) throw new Error("Creating entries in this content item isn't allowed.");
      const basePath = parent ?? schema.path;
      if (basePath == null) throw new Error("Cannot create entry without a target path.");
      savePath = joinPathSegments([basePath, showFilename ? normalizedFilename : generateFilename(schema.filename, schema, values)]);
    } else if (showFilename && filenameMode === "enabled" && normalizedFilename !== getFileName(savePath)) {
      if (!canRename && schemaType === "collection") throw new Error("Renaming this entry isn't allowed.");
      if (filenameUnlocked && schemaType === "collection") {
        const newPath = joinPathSegments([getParentPath(savePath), normalizedFilename]);
        const response = await fetch(`/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/files/${encodeURIComponent(savePath)}/rename`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "content", name, newPath }),
        });
        await requireApiSuccess(response, "Failed to rename file");
        savePath = newPath;
        saveQueue.rename(newPath);
        setPath(newPath);
        window.history.replaceState(null, "", editUrlFor(newPath));
      }
    }

    const response = await fetch(`/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/files/${encodeURIComponent(savePath)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: savePath === ".pages.yml" ? "settings" : "content", name,
        content: schema?.list === true ? values.listWrapper : values,
        sha: base.sha,
      }),
    });
    const result = await requireApiSuccess<ApiSuccess<EntryData>>(response, "Failed to save file");
    return { ...result.data, message: result.message };
  };

  const applySavedEntry = (request: EntrySaveRequest, result: EntrySaveResult) => {
    const confirmed: EntryData = {
      ...result,
      contentObject: schema?.list === true ? request.values.listWrapper as Record<string, unknown> : request.values,
    };
    // Publish the same confirmed version to the editor and SWR, synchronously
    // with the queue's SHA update. Late pre-save reads cannot roll it back.
    setEntry(confirmed);
    setPath(result.path);
    setSha(result.sha);
    setError(null);
    setNeedsSignIn(false);
    setLastSavedAt(Date.now());
    if (user && result.path !== path) {
      try {
        moveEntryDraft(window.localStorage,
          entryDraftKey(user.id, config.owner, config.repo, config.branch, path ?? `new:${name}:${parent ?? ""}`),
          entryDraftKey(user.id, config.owner, config.repo, config.branch, result.path), result.sha);
      } catch { /* The draft hook reports storage failures and keeps the editor open. */ }
    }
    if (request.editVersion === changeVersionRef.current) {
      setHasRegisteredChanges(false);
      setHasChangesSinceSubmit(false);
    }
    const confirmedUrl = `/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/entries/${encodeURIComponent(result.path)}?name=${encodeURIComponent(name)}`;
    void mutate([confirmedUrl, saveQueue.id], { ...confirmed, readEpoch: saveQueue.epoch, readDuringSave: false }, { revalidate: false });
    if (!initialPath && schemaType === "collection") {
      // Keep the mounted form and edits made during the create request. A router
      // navigation would remount it before those edits can be saved.
      window.history.replaceState(null, "", editUrlFor(result.path));
    }
    if (result.commitSha && result.path !== ".pages.yml") {
      trackPublication({ owner: config.owner, repo: config.repo, branch: config.branch, commitSha: result.commitSha, path: result.path });
    }
    if (schemaType === "collection") {
      const prefix = `/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collections/${encodeURIComponent(name)}?`;
      void mutate((key) => typeof key === "string" && key.startsWith(prefix));
    }
    onSave?.(confirmed);
  };

  useEffect(() => {
    saveHandlersRef.current = { persist: persistEntry, onSaved: applySavedEntry };
  });

  const onSubmit = async (contentObject: Record<string, unknown>) => {
    setHasChangesSinceSubmit(false);
    const saving = saveQueue.enqueue({
      values: contentObject, editVersion: changeVersionRef.current, filename: filenameValue,
      showFilenameField, filenameFieldMode, filenameUnlocked: isFilenameUnlocked,
    });
    toast.promise(saving, {
      loading: "게시 내용 저장 중",
      success: "게시 내용 저장 완료 · 배포 상태를 확인하고 있어요.",
      error: (error: unknown) => error instanceof Error ? error.message : "저장하지 못했어요. 임시 초안을 유지했어요.",
    });
    try {
      const result = await saving;
      return { saved: true as const, sha: result.sha, path: result.path };
    } catch (error: unknown) {
      if ((error as { status?: number })?.status === 401) setNeedsSignIn(true);
      setHasChangesSinceSubmit(true);
      return false;
    }
  };

  const isBusy = isLoading || isSaving;

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s") return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey) return;

      event.preventDefault();
      if (isLoading) return;

      const form = document.getElementById("entry-form");
      if (form instanceof HTMLFormElement) {
        form.requestSubmit();
      }
    };

    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [isLoading]);

  const handleDelete = useCallback((path: string) => {
    // TODO: disable save button or freeze form while deleting?
    if (schemaType === "collection") {
      const collectionKeyPrefix = `/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collections/${encodeURIComponent(name)}?`;
      void mutate((key) => typeof key === "string" && key.startsWith(collectionKeyPrefix));
    }
    if (schemaType === "collection") {
      router.push(`/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collection/${encodeURIComponent(name)}`);
    } else {
      if (entryApiUrl) {
        void mutate(entryApiUrl, undefined, { revalidate: true });
      }
      void mutateEntry();
    }
  }, [config.branch, config.owner, config.repo, entryApiUrl, mutate, mutateEntry, name, router, schemaType]);

  const handleRename = useCallback((oldPath: string, newPath: string) => {
    if (schemaType === "collection") {
      const collectionKeyPrefix = `/api/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collections/${encodeURIComponent(name)}?`;
      void mutate((key) => typeof key === "string" && key.startsWith(collectionKeyPrefix));
    }
    if (entryApiUrl) {
      void mutate(entryApiUrl, undefined, { revalidate: false });
    }
    setPath(newPath);
    saveQueue.rename(newPath);
    window.history.replaceState(null, "", `/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collection/${encodeURIComponent(name)}/edit/${encodeURIComponent(newPath)}`);
  }, [config.branch, config.owner, config.repo, entryApiUrl, mutate, name, saveQueue, schemaType]);

  const breadcrumbNode = useMemo(() => {
    if (!schema) {
      return <BreadcrumbPage className="font-semibold truncate">{displayTitle}</BreadcrumbPage>;
    }

    const groupTrail: GroupTrailItem[] = Array.isArray(schema.groupTrail)
      ? schema.groupTrail
      : [];

    if (schemaType !== "collection") {
      return (
        <>
          {groupTrail.map((group) => (
            <Fragment key={`group-${group.name}`}>
              <BreadcrumbItem>
                <span>{group.label || group.name}</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </Fragment>
          ))}
          <BreadcrumbItem className="truncate">
            <BreadcrumbPage className="font-semibold truncate">{displayTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </>
      );
    }

    const rootLabel = schema.label || schema.name || name;

    if (!path) {
      return (
        <>
          {groupTrail.map((group) => (
            <Fragment key={`group-${group.name}`}>
              <BreadcrumbItem>
                <span>{group.label || group.name}</span>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
            </Fragment>
          ))}
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collection/${encodeURIComponent(name)}`}>
                {rootLabel}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="truncate">
            <BreadcrumbPage className="font-semibold truncate">{displayTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </>
      );
    }

    const rootPath = normalizePath(schema.path);
    const parentPath = normalizePath(getParentPath(path));
    const relativePath = getRelativePath(parentPath, rootPath);
    const segments = relativePath ? relativePath.split("/").filter(Boolean) : [];

    const parentEntries = segments.map((segment, index) => ({
      name: segment,
      path: joinPathSegments([rootPath, segments.slice(0, index + 1).join("/")]),
    }));

    const immediateParent = parentEntries.length > 0 ? parentEntries[parentEntries.length - 1] : null;
    const middleEntries = parentEntries.length > 1 ? parentEntries.slice(0, -1) : [];

    return (
      <>
        {groupTrail.map((group) => (
          <Fragment key={`group-${group.name}`}>
            <BreadcrumbItem>
              <span>{group.label || group.name}</span>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </Fragment>
        ))}
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href={`/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collection/${encodeURIComponent(name)}`}>
              {rootLabel}
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />

        {middleEntries.length > 0 && (
          <>
            <BreadcrumbItem>
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center">
                  <BreadcrumbEllipsis className="h-4 w-4" />
                  <span className="sr-only">Show hidden segments</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {middleEntries.map((entry) => (
                    <DropdownMenuItem key={entry.path} asChild>
                      <Link href={`/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collection/${encodeURIComponent(name)}?path=${encodeURIComponent(entry.path)}`}>
                        {entry.name}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}

        {immediateParent && (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={`/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collection/${encodeURIComponent(name)}?path=${encodeURIComponent(immediateParent.path)}`}>
                  {immediateParent.name}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}

        <BreadcrumbItem className="truncate">
          <BreadcrumbPage className="font-semibold truncate">{displayTitle}</BreadcrumbPage>
        </BreadcrumbItem>
      </>
    );
  }, [config.branch, config.owner, config.repo, displayTitle, name, path, schema, schemaType]);
  const isCreationBlocked = !path && schemaType === "collection" && !canCreate;
  const showHeaderActions = error !== "Not found" && !isCreationBlocked;
  const headerActionsNode = useMemo(() => {
    if (!schema || !path) return null;

    if (schemaType === "file") {
      const fileActions = getSchemaActions(schema);
      if (fileActions.length === 0) return null;

      return (
        <RepoActionButtons
          actions={fileActions}
          owner={config.owner}
          repo={config.repo}
          refName={config.branch}
          contextType="file"
          contextName={schema.name}
          contextPath={path}
          contextData={{
            label: schema.label || schema.name,
            sha: sha ?? null,
            content: entry?.contentObject ?? null,
          }}
        />
      );
    }

    if (schemaType === "collection" && entry) {
      const entryActions = getSchemaActions(schema, "entry");
      if (entryActions.length === 0) return null;

      return (
        <RepoActionButtons
          actions={entryActions}
          owner={config.owner}
          repo={config.repo}
          refName={config.branch}
          contextType="entry"
          contextName={schema.name}
          contextPath={path}
          contextData={{
            label: schema.label || schema.name,
            entryName: entry.name ?? null,
            sha: sha ?? null,
            content: entry.contentObject ?? null,
          }}
        />
      );
    }

    return null;
  }, [config.branch, config.owner, config.repo, entry, path, schema, schemaType, sha]);

  const headerNode = useMemo(() => (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <Breadcrumb className="min-w-0 overflow-hidden">
          <BreadcrumbList className="min-w-0 flex-nowrap font-semibold text-lg">
            {breadcrumbNode}
          </BreadcrumbList>
        </Breadcrumb>
        {headerMeta}
      </div>
      {showHeaderActions && (
        <div className="flex shrink-0 items-center gap-x-2">
          <span role="status" className="hidden text-xs text-muted-foreground md:inline">
            {isSaving ? "게시 처리 중 · 계속 작성 가능" : lastSavedAt ? `게시 요청 완료 · ${new Date(lastSavedAt).toLocaleTimeString("ko-KR")}` : ""}
          </span>
          {headerActionsNode}
          {path && (
            historyData && historyData.length > 0 && !isLoading
              ? (
                <EntryHistoryDropdown
                  history={historyData}
                  path={path}
                  triggerVariant="outline"
                  triggerSize="icon"
                />
              )
              : <Button variant="outline" size="icon" className="shrink-0" disabled><History /></Button>
          )}
          {name && path !== ".pages.yml" && <Button type="submit" form="entry-form" variant="outline" disabled={isLoading} aria-label="저장">저장</Button>}
          <Button
            type="submit"
            form="entry-form"
            data-publish="true"
            disabled={
              isLoading || (isSaving && !hasChangesSinceSubmit) ||
              (showFilenameField && filenameValue.trim().length === 0) ||
              (
                Boolean(path) &&
                !(
                  isFormDirty
                  || hasRegisteredChanges
                  || (
                    showFilenameField
                    && filenameFieldMode === "enabled"
                    && isFilenameUnlocked
                    && filenameChanged
                  )
                )
              )
            }
            aria-label={name && path !== ".pages.yml" ? "게시" : "저장"}
          >
            <Save className="size-4 sm:hidden" />
            <span className="hidden sm:inline">{name && path !== ".pages.yml" ? isSaving ? "게시 중" : "게시" : "저장"}</span>
          </Button>
          {path && (
            <ButtonGroup>
              {sha
                ? (
                  <FileOptions
                    path={path}
                    sha={sha}
                    type={path === ".pages.yml" ? "settings" : (schemaType ?? "content")}
                    name={name}
                    canDelete={canDelete}
                    canRename={canRename}
                    onDelete={handleDelete}
                    onRename={handleRename}
                  >
                    <Button variant="outline" size="icon" disabled={isBusy}>
                      <EllipsisVertical />
                    </Button>
                  </FileOptions>
                )
                : <Button variant="outline" size="icon" disabled><EllipsisVertical /></Button>
              }
            </ButtonGroup>
          )}
        </div>
      )}
    </div>
  ), [breadcrumbNode, canDelete, canRename, filenameChanged, filenameFieldMode, filenameValue, handleDelete, handleRename, hasRegisteredChanges, hasChangesSinceSubmit, headerActionsNode, headerMeta, historyData, isBusy, isSaving, lastSavedAt, isFilenameUnlocked, isFormDirty, isLoading, name, path, schemaType, sha, showFilenameField, showHeaderActions]);

  useRepoHeader({ header: headerNode });

  const loadingSkeleton = useMemo(() => (
    <div className="w-full max-w-screen-md mx-auto grid items-start gap-6">
      {path !== ".pages.yml"
        ? 
          <>
            <div className="space-y-2">
              <Skeleton className="w-24 h-5 rounded" />
              <Skeleton className="w-full h-10 rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="w-24 h-5 rounded" />
              <Skeleton className="w-full h-10 rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="w-24 h-5 rounded" />
              <div className="grid grid-flow-col auto-cols-max gap-4">
                <Skeleton className="w-28 h-28 rounded-md" />
                <Skeleton className="w-28 h-28 rounded-md" />
                <Skeleton className="w-28 h-28 rounded-md" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="w-24 h-5 rounded" />
              <Skeleton className="w-full h-60 rounded-md" />
            </div>
          </>
        : <Skeleton className="w-full h-96 rounded-md" />
      }
    </div>
  ), [path]);

  
  if (error && !entry) {
    // TODO: should we use a custom error class with code?
    // TODO: errors show no header (unlike collection and media). Consider standardizing templates.
    if (error === "Not found") {
      const isSettingsPage = path === ".pages.yml";
      return (
        <div className="absolute inset-0 p-4 md:p-6 flex items-center justify-center">
          <Empty className="max-w-[420px] flex-none">
            <EmptyHeader>
              <EmptyTitle>{isSettingsPage ? "Configuration not found" : "File not found"}</EmptyTitle>
              <EmptyDescription>
                {isSettingsPage
                  ? "The configuration file \".pages.yml\" does not exist yet."
                  : `The file "${path ?? schema?.path ?? "unknown"}" does not exist yet.`}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {isSettingsPage ? (
                <EmptyCreate type="settings">Create configuration file</EmptyCreate>
              ) : canCreate ? (
                <EmptyCreate type="content" name={schema?.name ?? name}>Create file</EmptyCreate>
              ) : null}
            </EmptyContent>
          </Empty>
        </div>
      );
    } else {
      return (
        <div className="absolute inset-0 p-4 md:p-6 flex items-center justify-center">
          <Empty className="max-w-[420px] flex-none">
            <EmptyHeader>
              <EmptyTitle>Something went wrong</EmptyTitle>
              <EmptyDescription>{error}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Link
                className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
                href={`/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/configuration`}
              >
                Go to configuration
              </Link>
            </EmptyContent>
          </Empty>
        </div>
      );
    }
  }

  if (!path && schemaType === "collection" && !canCreate) {
    return (
      <div className="absolute inset-0 p-4 md:p-6 flex items-center justify-center">
        <Empty className="max-w-[420px] flex-none">
          <EmptyHeader>
            <EmptyTitle>Creating entries is disabled</EmptyTitle>
            <EmptyDescription>
              New entries are not allowed for this collection.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90"
              href={`/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/collection/${encodeURIComponent(name)}`}
            >
              Back to collection
            </Link>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  
  return (
    (isLoading || (Boolean(path) && !entry))
      ? loadingSkeleton
      : <div className="space-y-4">
      {needsSignIn && <div role="alert" className="mx-auto max-w-screen-md rounded-md border p-3 text-sm">
        로그인이 만료됐어요. 초안은 이 브라우저에 보관돼요. <a className="underline" href={`/sign-in?redirect=${encodeURIComponent(window.location.pathname)}`} target="_blank" rel="noopener noreferrer">새 탭에서 다시 로그인</a>한 뒤 이 탭에서 저장해 주세요.
      </div>}
      <EntryForm
        key={JSON.stringify([user?.id, config.owner, config.repo, config.branch, name, initialPath, parent])}
        draftStorageKey={user ? entryDraftKey(user.id, config.owner, config.repo, config.branch, path ?? `new:${name}:${parent ?? ""}:${draftIdentity}`) : undefined}
        serverDraft={user && name && path !== ".pages.yml" ? { scope: JSON.stringify([config.owner, config.repo, config.branch, name]), identity: draftIdentity, path, baseSha: sha } : undefined}
        baseSha={sha}
        fields={entryFields}
        contentObject={entryContentObject}
        onSubmit={onSubmit}
        filePath={
          showFilenameField
            ? <InputGroup data-disabled={path ? !isFilenameUnlocked : false}>
                <InputGroupInput
                  value={filenameValue}
                  onChange={(event) => {
                    setFilenameValue(event.target.value);
                    unsavedRef.current = true;
                    changeVersionRef.current++;
                    setHasRegisteredChanges(true);
                    setHasChangesSinceSubmit(true);
                  }}
                  placeholder="Filename"
                  disabled={path ? !isFilenameUnlocked : false}
                  aria-label="Filename"
                />
                {path && filenameFieldMode === "enabled" && canRename && (
                  <InputGroupAddon align="inline-end">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <InputGroupButton
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setIsFilenameUnlocked((prev) => !prev)}
                          aria-label={isFilenameUnlocked ? "Lock filename" : "Unlock filename"}
                        >
                          {isFilenameUnlocked
                            ? <LockOpen className="size-3.5" />
                            : <Lock className="size-3.5" />}
                        </InputGroupButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        {isFilenameUnlocked ? "Lock filename" : "Unlock to edit"}
                      </TooltipContent>
                    </Tooltip>
                  </InputGroupAddon>
                )}
              </InputGroup>
            : undefined
        }
        onDirtyChange={setIsFormDirty}
        onChangeRegistered={() => {
          unsavedRef.current = true;
          changeVersionRef.current += 1;
          setHasRegisteredChanges(true);
          setHasChangesSinceSubmit(true);
        }}
      />
      </div>
  );
};
