import React, { useState, useRef, useEffect, useMemo, useCallback }
from 'react';
import { AgGridReact } from 'ag-grid-react'; // the AG Grid React Component
import GitHubLogin from 'react-github-login';
import 'ag-grid-community/dist/styles/ag-grid.css'; // Core grid CSS, always needed
import 'ag-grid-community/dist/styles/ag-theme-alpine.css'; // Optional theme CSS

const onSuccess = response => console.log(response);
const onFailure = response => console.error(response);

const App = () => {

  const gridRef = useRef(); // Optional - for accessing Grid's API
  const [rowData, setRowData] = useState(); // Set rowData to Array of Objects, one Object per Row

  // Each Column Definition results in one Column.
  const [columnDefs] = useState([
    { field: 'name', filter: true },
    { field: 'form', filter: true },
    { field: 'subject', filter: true },
    { field: 'notation'},
    { field: 'speech_hints'},
    { field: 'sources' },
    { field: 'notes' },
  ]);

  // DefaultColDef sets props common to all Columns
  const defaultColDef = useMemo(() => ({
    sortable: true,
    resizable: true,
  }), []);

  // Example of consuming Grid Event
  const cellClickedListener = useCallback(event => {
    console.log('cellClicked', event);
  }, []);

  // Example load data from sever
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/dginev/mathml-intent-open/main/intent_open.json')
      .then(result => result.json())
      .then(objData => {
        let rowData = [];
        for (let [key, value] of Object.entries(objData)) {
          value['name'] = key;
          rowData.push(value);
        }
        setRowData(rowData)
      })
  }, []);

  // Example using Grid's API
  const buttonListener = useCallback(e => {
    gridRef.current.api.deselectAll();
  }, []);

  return (
    <div>
      <div className="gh-login">
        <GitHubLogin clientId="285c56f081dbf7d15ce7" onSuccess={onSuccess} onFailure={onFailure} />
      </div>

      {/* Example using Grid's API */}
      <button onClick={buttonListener}>Deselect All</button>

      {/* On div wrapping Grid a) specify theme CSS Class Class and b) sets Grid size */}
      <div className="ag-theme-alpine" style={{ width: 1920, height: 1080 }}>

        <AgGridReact
          ref={gridRef} // Ref for accessing Grid's API

          rowData={rowData} // Row Data for Rows

          columnDefs={columnDefs} // Column Defs for Columns
          defaultColDef={defaultColDef} // Default Column Properties

          animateRows={true} // Optional - set to 'true' to have rows animate when sorted
          rowSelection='multiple' // Options - allows click selection of rows

          onCellClicked={cellClickedListener} // Optional - registering for Grid Event
        />
      </div>
    </div>
  );
};

export default App;