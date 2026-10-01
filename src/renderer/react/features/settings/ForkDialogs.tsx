import { Input, Modal } from "antd";
import { createElement } from "react";
type DialogOptions = { title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean; placeholder?: string; [key: string]: unknown };
export function confirmForkDialog(options: DialogOptions): Promise<boolean> {
  return new Promise(resolve => Modal.confirm({ title: options.title, content: options.message, okText: options.confirmText ?? "确认", cancelText: options.cancelText ?? "取消", okButtonProps: { danger: options.danger }, onOk: () => resolve(true), onCancel: () => resolve(false) }));
}
export function inputForkDialog(options: DialogOptions): Promise<string | null> {
  let value = "";
  return new Promise(resolve => Modal.confirm({ title: options.title, content: createElement("div", null, createElement("p", null, options.message), createElement(Input, { placeholder: options.placeholder, "aria-label": options.title, onChange: (event: { target: { value: string } }) => { value = event.target.value; } })), okText: options.confirmText ?? "确认", cancelText: options.cancelText ?? "取消", okButtonProps: { danger: options.danger }, onOk: () => resolve(value), onCancel: () => resolve(null) }));
}
