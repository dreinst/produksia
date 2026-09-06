export type FieldConfig = {
  name: string;
  label: string;
  type: "text" | "number" | "select";
  required?: boolean;
  defaultValue?: string;
  options?: { model: string; valueField: string; labelField: string };
  staticOptions?: string[];
};

export type EntityConfig = {
  slug: string;
  label: string;
  model: string; // Prisma client delegate name
  section: "persediaan" | "daftar";
  fields: FieldConfig[];
  columns: { key: string; label: string }[];
};

export const masterEntities: EntityConfig[] = [
  {
    slug: "departments",
    label: "Departemen",
    model: "department",
    section: "daftar",
    fields: [{ name: "name", label: "Nama", type: "text", required: true }],
    columns: [{ key: "name", label: "Nama" }],
  },
  {
    slug: "employees",
    label: "Penjual / Karyawan",
    model: "employee",
    section: "daftar",
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      {
        name: "departmentId",
        label: "Departemen",
        type: "select",
        options: { model: "department", valueField: "id", labelField: "name" },
      },
    ],
    columns: [
      { key: "code", label: "Kode" },
      { key: "name", label: "Nama" },
      { key: "department.name", label: "Departemen" },
    ],
  },
  {
    slug: "customers",
    label: "Pelanggan",
    model: "customer",
    section: "daftar",
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "address", label: "Alamat", type: "text" },
      { name: "phone", label: "Telepon", type: "text" },
      { name: "npwp", label: "NPWP", type: "text" },
      {
        name: "salesId",
        label: "Sales",
        type: "select",
        options: { model: "employee", valueField: "id", labelField: "name" },
      },
    ],
    columns: [
      { key: "code", label: "Kode" },
      { key: "name", label: "Nama" },
      { key: "phone", label: "Telepon" },
      { key: "sales.name", label: "Sales" },
    ],
  },
  {
    slug: "suppliers",
    label: "Pemasok",
    model: "supplier",
    section: "daftar",
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "address", label: "Alamat", type: "text" },
      { name: "phone", label: "Telepon", type: "text" },
    ],
    columns: [
      { key: "code", label: "Kode" },
      { key: "name", label: "Nama" },
      { key: "phone", label: "Telepon" },
    ],
  },
  {
    slug: "projects",
    label: "Proyek",
    model: "project",
    section: "daftar",
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      {
        name: "customerId",
        label: "Pelanggan",
        type: "select",
        options: { model: "customer", valueField: "id", labelField: "name" },
      },
      {
        name: "status",
        label: "Status",
        type: "text",
        defaultValue: "OPEN",
      },
    ],
    columns: [
      { key: "code", label: "Kode" },
      { key: "name", label: "Nama" },
      { key: "customer.name", label: "Pelanggan" },
      { key: "status", label: "Status" },
    ],
  },
  {
    slug: "warehouses",
    label: "Gudang",
    model: "warehouse",
    section: "persediaan",
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "address", label: "Alamat", type: "text" },
    ],
    columns: [
      { key: "code", label: "Kode" },
      { key: "name", label: "Nama" },
    ],
  },
  {
    slug: "categories",
    label: "Kelompok Barang",
    model: "itemCategory",
    section: "persediaan",
    fields: [
      { name: "name", label: "Nama", type: "text", required: true },
      {
        name: "parentId",
        label: "Kelompok Induk",
        type: "select",
        options: { model: "itemCategory", valueField: "id", labelField: "name" },
      },
    ],
    columns: [
      { key: "name", label: "Nama" },
      { key: "parent.name", label: "Induk" },
    ],
  },
  {
    slug: "items",
    label: "Barang & Jasa",
    model: "item",
    section: "persediaan",
    fields: [
      { name: "code", label: "Kode", type: "text", required: true },
      { name: "name", label: "Nama", type: "text", required: true },
      { name: "type", label: "Tipe", type: "select", staticOptions: ["BARANG", "JASA"], defaultValue: "BARANG" },
      {
        name: "categoryId",
        label: "Kelompok",
        type: "select",
        options: { model: "itemCategory", valueField: "id", labelField: "name" },
      },
      { name: "unit", label: "Satuan", type: "text", defaultValue: "pcs" },
      { name: "costPrice", label: "Harga Beli", type: "number", defaultValue: "0" },
      { name: "sellPrice", label: "Harga Jual", type: "number", defaultValue: "0" },
      { name: "minStock", label: "Stok Minimum", type: "number", defaultValue: "0" },
    ],
    columns: [
      { key: "code", label: "Kode" },
      { key: "name", label: "Nama" },
      { key: "type", label: "Tipe" },
      { key: "unit", label: "Satuan" },
      { key: "sellPrice", label: "Harga Jual" },
    ],
  },
  {
    slug: "accounts",
    label: "Daftar Akun",
    model: "account",
    section: "daftar",
    fields: [
      { name: "code", label: "Kode Akun", type: "text", required: true },
      { name: "name", label: "Nama Akun", type: "text", required: true },
      {
        name: "type",
        label: "Tipe",
        type: "select",
        staticOptions: ["ASET", "KEWAJIBAN", "MODAL", "PENDAPATAN", "BEBAN"],
        required: true,
      },
      {
        name: "parentId",
        label: "Induk Akun",
        type: "select",
        options: { model: "account", valueField: "id", labelField: "name" },
      },
    ],
    columns: [
      { key: "code", label: "Kode" },
      { key: "name", label: "Nama" },
      { key: "type", label: "Tipe" },
      { key: "parent.name", label: "Induk" },
    ],
  },
];

export function getEntityConfig(slug: string) {
  return masterEntities.find((e) => e.slug === slug);
}

export function getValue(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
