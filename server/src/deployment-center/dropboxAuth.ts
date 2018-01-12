import { Application } from 'express';
import axios from 'axios';
import { oAuthHelper } from './OAuthHelper';

const oauthHelper: oAuthHelper = new oAuthHelper('dropbox');
export async function getDropboxTokens(req: any): Promise<any> {
	return await oauthHelper.getToken(req.headers.authorization);
}
export function setupDropboxAuthentication(app: Application) {
	app.post('/api/dropbox/passthrough', async (req, res) => {
		const tokenData = await getDropboxTokens(req);
		if (!tokenData.authenticated) {
			res.sendStatus(401);
			return;
		}
		try {
			const response = await axios.post(req.body.url, req.body.arg, {
				headers: {
					Authorization: `Bearer ${tokenData.token}`,
					'Content-Type': req.body.content_type || ''
				}
			});
			res.json(response.data);
		} catch (err) {
			console.log(err);
			res.sendStatus(401);
		}
	});

	app.get('/auth/dropbox/authorize', (req, res) => {
		let stateKey = '';
		if (req && req.session) {
			stateKey = req.session['dropbox_state_key'] = oauthHelper.newGuid();
		}

		res.redirect(
			`https://dropbox.com/oauth2/authorize?client_id=${process.env.DROPBOX_CLIENT_ID}&redirect_uri=${process.env
				.DROPBOX_REDIRECT_URL}&response_type=code&state=${oauthHelper.hashStateGuid(stateKey).substr(0, 10)}`
		);
	});

	app.get('/auth/dropbox/callback', (_, res) => {
		res.sendStatus(200);
	});

	app.post('/auth/dropbox/storeToken', async (req, res) => {
		const code = oauthHelper.getParameterByName('code', req.body.redirUrl);
		const state = oauthHelper.getParameterByName('state', req.body.redirUrl);

		if (
			!req ||
			!req.session ||
			!req.session['dropbox_state_key'] ||
			oauthHelper.hashStateGuid(req.session['dropbox_state_key']).substr(0, 10) !== state
		) {
			res.sendStatus(403);
			return;
		}
		try {
			const r = await axios.post(
				`https://api.dropbox.com/oauth2/token`,
				`code=${code}&grant_type=authorization_code&redirect_uri=${process.env.DROPBOX_REDIRECT_URL}&client_id=${process.env
					.DROPBOX_CLIENT_ID}&client_secret=${process.env.DROPBOX_CLIENT_SECRET}`,
				{
					headers: {
						'Content-type': 'application/x-www-form-urlencoded'
					}
				}
			);
			const token = r.data.access_token as string;
			oauthHelper.putTokenInArm(token, req.headers.authorization as string);
			res.sendStatus(200);
		} catch (err) {
			console.log(err);
			res.sendStatus(400);
		}
	});
}