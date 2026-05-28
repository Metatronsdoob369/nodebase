"use client";

import { memo, useState } from "react";
import { NodeProps } from "@xyflow/react";
import { BaseTriggerNode } from "../base-trigger-node";
import { WebhookIcon } from "lucide-react";

export const WebhookTriggerNode = memo((props: NodeProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleOpenSettings = () => {
    setDialogOpen(true);
  };

  return (
    <BaseTriggerNode
      {...props}
      icon={WebhookIcon}
      name="On Webhook Received"
      description="Triggers when a POST request hits /api/webhook/ingest"
      status="initial"
      onSettings={handleOpenSettings}
      onDoubleClick={handleOpenSettings}
    />
  );
});

WebhookTriggerNode.displayName = "WebhookTriggerNode";
