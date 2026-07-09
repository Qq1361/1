"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ApiError, AttachmentDto } from "@/types/purchase";

export function AttachmentUploader({
  entityType,
  entityId,
  initialAttachments,
  compact = false,
}: {
  entityType: "PURCHASE_ORDER" | "PURCHASE_ORDER_ITEM" | "INSPECTION";
  entityId: string;
  initialAttachments: AttachmentDto[];
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState(initialAttachments);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({ entityType, entityId });
    fetch(`/api/attachments?${params}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((data: AttachmentDto[]) => setAttachments(data));
  }, [entityId, entityType]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.set("entityType", entityType);
      formData.set("entityId", entityId);
      formData.set("file", file);
      const response = await fetch("/api/attachments", {
        method: "POST",
        body: formData,
      });
      if (response.ok) {
        const attachment = (await response.json()) as AttachmentDto;
        setAttachments((current) => [attachment, ...current]);
      } else {
        const error = (await response.json()) as ApiError;
        toast.error(`${file.name}: ${error.message}`);
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function remove(attachment: AttachmentDto) {
    const response = await fetch(`/api/attachments/${attachment.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      toast.error("删除附件失败");
      return;
    }
    setAttachments((current) =>
      current.filter((item) => item.id !== attachment.id),
    );
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(event) => upload(event.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`flex w-full items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/60 ${compact ? "min-h-20" : "min-h-28"}`}
      >
        {uploading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}
        {uploading ? "正在上传" : "上传 JPEG、PNG 或 WebP，单张不超过 10 MB"}
      </button>
      {attachments.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
            >
              <Image
                src={`/api/attachments/${attachment.id}/content`}
                alt={attachment.fileName}
                fill
                unoptimized
                className="object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon-sm"
                className="absolute right-1.5 top-1.5 opacity-90"
                onClick={() => remove(attachment)}
                aria-label={`删除 ${attachment.fileName}`}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ImagePlus className="size-3.5" />
          暂无图片
        </div>
      )}
    </div>
  );
}
