
let dataStore=[]
let chartInstance=null

async function fetchData(){
  const res=await fetch('/admin/api/data')
  const json=await res.json()
  dataStore=json.data
  render()
}

function render(){

  const tbody=document.getElementById('tbody')
  tbody.innerHTML=''

  dataStore.forEach(r=>{

    tbody.innerHTML+=`
    <tr>
      <td><input type="checkbox" class="rowCheck" value="${r.id}"></td>
      <td>${r.email}</td>
      <td>${r.email_sent?'Oui':'Non'}</td>
      <td>${r.used?'Oui':'Non'}</td>
    </tr>
    `

  })

  const total=dataStore.length
  const activated=dataStore.filter(r=>r.used).length
  const rate=total?Math.round((activated/total)*100):0

  document.getElementById("totalEmails").innerText=total
  document.getElementById("activated").innerText=activated
  document.getElementById("rate").innerText=rate+"%"

  const notActivated=total-activated

  if(chartInstance) chartInstance.destroy()

  chartInstance=new Chart(document.getElementById('chart'),{
    type:'doughnut',
    data:{
      labels:['Activé','Non activé'],
      datasets:[{
        data:[activated,notActivated],
        backgroundColor:['#22c55e','#ef4444']
      }]
    },
    options:{responsive:true,maintainAspectRatio:false}
  })

}

function sendEmails(){
  fetch('/admin/send-emails',{method:'POST'}).then(fetchData)
}

function resendEmails(){
  fetch('/admin/resend-emails',{method:'POST'}).then(fetchData)
}

function deleteAll(){
  if(!confirm("Supprimer tous les emails ?")) return
  fetch('/admin/delete-all',{method:'POST'}).then(fetchData)
}

function deleteSelected(){

  const ids=[...document.querySelectorAll('.rowCheck:checked')].map(x=>x.value)

  fetch('/admin/delete-selected',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ids})
  }).then(fetchData)

}

fetchData()
