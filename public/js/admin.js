let dataStore=[];
let chartInstance=null;

async function fetchData(){
  const res=await fetch('/admin/api/data');
  const json=await res.json();
  dataStore=json.data;
  render();
}

function render(){
  const tbody=document.getElementById('tbody');
  tbody.innerHTML='';

  dataStore.forEach(r=>{
    const row=document.createElement('tr');
    row.innerHTML =
      "<td>"+r.email+"</td>" +
      "<td class='"+(r.email_sent?"badge-ok":"badge-wait")+"'>"+
      (r.email_sent?"Oui":"Non")+"</td>" +
      "<td class='"+(r.used?"badge-ok":"badge-wait")+"'>"+
      (r.used?"Oui":"Non")+"</td>";
    tbody.appendChild(row);
  });

  const sent=dataStore.filter(r=>r.email_sent).length;
  const pending=dataStore.length-sent;

  if(chartInstance) chartInstance.destroy();

  chartInstance=new Chart(document.getElementById('chart'),{
    type:'doughnut',
    data:{
      labels:['Envoyé','En attente'],
      datasets:[{
        data:[sent,pending],
        backgroundColor:['#22c55e','#f59e0b']
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      cutout:'65%',
      plugins:{legend:{display:false}}
    }
  });
}

function sendEmails(){
  fetch('/admin/send-emails',{method:'POST'}).then(fetchData);
}

function resendEmails(){
  fetch('/admin/resend-emails',{method:'POST'}).then(fetchData);
}

fetchData();
