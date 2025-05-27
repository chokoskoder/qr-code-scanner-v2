//before we can start we need to wait for the DOM content to be loaded fully so we can actually use it to our advantage

document.addEventListener("DOMContentLoaded" , function () {
	const startSnipButton = document.getElementById('startSnipButton')
	//this is where EDA comes , we are going to collect the dom status of the button we created in popup.html and now we write the logic to check if the button has been clicked and if it has been we update our main script 

	if(startSnipButton){ // we need to check that does such a button even exist ???
		
		startSnipButton.addEventListener('click' , function () {
			console.log("the snip qr button has been hit ")

				//now we send our meesage as an object , which helps in identifying the action to be taken 
				chrome.runtime.sendMessage({action : "startSnipMode"} , function(response) {
					if(chrome.runtime.lastError){
						console.error('error sending message :' , chrome.runtime.lastError.message)
					}
					else if (response){
						console.log('Response from background:', response);
					}


					window.close();
				});
			
		});

} else {
	console.error("the snip button was not found ")
}

}
);