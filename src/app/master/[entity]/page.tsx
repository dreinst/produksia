import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import ActionForm from "@/components/ActionForm";
import { getEntityConfig, getValue } from "@/lib/masterConfig";
import { createMasterRecordForm, deleteMasterRecordForm } from "@/lib/actions/master";

type PrismaDelegate = {
  findMany: (args?: { include?: Record<string, boolean> }) => Promise<Record<string, unknown>[]>;
};

function delegate(model: string): PrismaDelegate {
  return (db as unknown as Record<string, PrismaDelegate>)[model];
}

export default async function MasterEntityPage({
  params,
}: {
  params: Promise<{ entity: string }>;
}) {
  const { entity } = await params;
  const config = getEntityConfig(entity);
  if (!config) notFound();

  const include: Record<string, boolean> = {};
  for (const col of config.columns) {
    if (col.key.includes(".")) include[col.key.split(".")[0]] = true;
  }

  const records = await delegate(config.model).findMany(
    Object.keys(include).length ? { include } : undefined,
  );

  const optionLists: Record<string, { id: string; label: string }[]> = {};
  for (const field of config.fields) {
    if (field.options) {
      const rows = await delegate(field.options.model).findMany();
      optionLists[field.name] = rows.map((r) => ({
        id: String(r[field.options!.valueField]),
        label: String(r[field.options!.labelField]),
      }));
    }
  }

  const boundCreateForm = createMasterRecordForm.bind(null, entity);

  return (
    <div className="space-y-8">
      <h1 className="page-title">{config.label}</h1>

      <ActionForm action={boundCreateForm} className="card grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        {config.fields.map((field) => (
          <div key={field.name} className="field">
            <label className="label">
              {field.label}
              {field.required && <span className="text-red-500"> *</span>}
            </label>
            {field.type === "select" ? (
              <select
                name={field.name}
                defaultValue={field.defaultValue ?? ""}
                className="input"
              >
                <option value="">-</option>
                {(field.staticOptions
                  ? field.staticOptions.map((o) => ({ id: o, label: o }))
                  : optionLists[field.name] ?? []
                ).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type === "number" ? "number" : "text"}
                step={field.type === "number" ? "0.01" : undefined}
                name={field.name}
                required={field.required}
                defaultValue={field.defaultValue}
                className="input"
              />
            )}
          </div>
        ))}
        <div className="md:col-span-2">
          <button type="submit" className="btn btn-primary">
            Tambah {config.label}
          </button>
        </div>
      </ActionForm>

      <div className="card card-table"><div className="table-wrap">
        <table className="tbl min-w-[36rem]">
        <thead>
          <tr>
            {config.columns.map((col) => (
              <th key={col.key} className={config.fields.find((f) => f.name === col.key)?.type === "number" ? "text-right" : undefined}>
                {col.label}
              </th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {records.map((rec) => (
            <tr key={String(rec.id)}>
              {config.columns.map((col) => {
                const isNumber = config.fields.find((f) => f.name === col.key)?.type === "number";
                const raw = getValue(rec, col.key);
                return (
                  <td key={col.key} className={isNumber ? "text-right num" : undefined}>
                    {isNumber ? Number(String(raw ?? 0)).toLocaleString("id-ID") : String(raw ?? "")}
                  </td>
                );
              })}
              <td>
                <ActionForm
                  action={deleteMasterRecordForm.bind(null, entity, String(rec.id))}
                  confirmMessage={`Hapus ${config.label} ini? Tindakan tidak bisa dibatalkan.`}
                >
                  <button type="submit" className="btn-link-danger">
                    Hapus
                  </button>
                </ActionForm>
              </td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr>
              <td colSpan={config.columns.length + 1} className="empty">
                Belum ada data.
              </td>
            </tr>
          )}
        </tbody>
        </table>
      </div></div>
    </div>
  );
}
