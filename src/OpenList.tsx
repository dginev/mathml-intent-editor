import React, {useId} from "react";
import jsyaml from "js-yaml";


import {
  useReactTable,
  getCoreRowModel,
  ColumnDef,
  flexRender
} from "@tanstack/react-table";

const MathMLRenderer: React.FC<{ mathml: string }> = ({ mathml }) => {
  return <span dangerouslySetInnerHTML={{__html: "<math>"+mathml+"</math>"}}/>
};



// Sample Data Type
interface OpenEntry {
  concept: string
  area?: string
  en: string
  notation: [string] // MathML content as a string
  description?: string
  links: [string]
}

// Define Columns
const columns: ColumnDef<OpenEntry>[] = [
  {
    accessorKey: "concept",
    header: "Concept",
  },
  {
    accessorKey: "notation",
    header: "Notation",
    cell: cell_v => (cell_v.getValue<[string]>()||[]).map(v=><MathMLRenderer key={useId()} mathml={v}/>),
  },
  {
    accessorKey: "description",
    header: "Description",
  },
  {
    accessorKey: "area",
    header: "Area"
  },
  {
    accessorKey: "en",
    header: "Speech Hint",
    cell: hint => <span className="hint">{hint.getValue<string>()}</span>
  },
  {
    accessorKey: "links",
    header: "Links",
    cell: links => (links.getValue<[string]>()||[]).map(v=><a className="definition-link" key={useId()} href={v}>{v}</a>),
  }
];

type Entries<T> = {
  [K in keyof T]: [K, T[K]];
}[keyof T][];

// Sample Data
let table_data : OpenEntry[] = [];
await fetch('/large_open.yml')
.then(r=> r.text())
.then((dataStr) => {
  let yml_data = jsyaml.load(dataStr) || {}
  const entries : Entries<typeof yml_data> = Object.entries(yml_data);
  for (let [key,value] of entries) {
    table_data.push({
      "concept": key,
      "area": value['area'],
      "en": value['en'],
      "notation": value['mathml'],
      "links": value['links'],
      "description": ""
    })
  }
  console.log("Done parse on data ", table_data.length)
});

const OpenList: React.FC = () => {
  const table = useReactTable({
    data: table_data,
    columns: columns,
    getCoreRowModel: getCoreRowModel(),
  });
  return (
    <div className="p-4 border border-gray-300 rounded-md">
      <table className="w-full border-collapse border border-gray-400">
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => (
                <th key={header.id} className="border border-gray-300 p-2">
                  {header.column.columnDef.header as string}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map(row => (
            <tr key={row.id}>
              {row.getVisibleCells().map(cell => (
                <td key={cell.id} className={(cell.column.columnDef.header as string).toLowerCase()}>
                 {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
                 
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default OpenList;
