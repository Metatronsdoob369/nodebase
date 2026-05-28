"use client";

import { memo } from "react";
import { NodeProps } from "@xyflow/react";
import { CodeIcon } from "lucide-react";
import { BaseExecutionNode } from "../http-request/base-execution-node";

export const CodeTransformNode = memo((props: NodeProps ) => {
  const handleOpenSettings = () => {};

  return (
    <BaseExecutionNode
      {...props}
      icon={CodeIcon}
      name="Transform / Code"
      description="Normalizes payload to TerrainIngest shape"
      status="initial"
      onSettings={handleOpenSettings}
      onDoubleClick={handleOpenSettings}
    />
  );
});

CodeTransformNode.displayName = "CodeTransformNode";
