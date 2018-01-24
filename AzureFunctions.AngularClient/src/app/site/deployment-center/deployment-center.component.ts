import { SiteConfig } from '../../shared/models/arm/site-config';
import { ArmObj } from '../../shared/models/arm/arm-obj';
import { CacheService } from '../../shared/services/cache.service';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/first';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/retry';
import 'rxjs/add/operator/switchMap';
import 'rxjs/add/observable/of';
import 'rxjs/add/observable/zip';
import { BusyStateScopeManager } from './../../busy-state/busy-state-scope-manager';
import { AuthzService } from '../../shared/services/authz.service';
import { Component, Input } from '@angular/core';
import { BroadcastService } from 'app/shared/services/broadcast.service';
import { BroadcastEvent } from 'app/shared/models/broadcast-event';
import { OnDestroy } from '@angular/core/src/metadata/lifecycle_hooks';
import { LogCategories } from 'app/shared/models/constants';
import { LogService } from 'app/shared/services/log.service';

@Component({
	selector: 'app-deployment-center',
	templateUrl: './deployment-center.component.html',
	styleUrls: ['./deployment-center.component.scss']
})
export class DeploymentCenterComponent implements OnDestroy {
	public resourceIdStream: Subject<string>;
	private _resourceId: string;
	@Input()
	set resourceId(resourceId: string) {
		this._resourceId = resourceId;
		this.resourceIdStream.next(resourceId);
	}

	get resourceId() {
		return this._resourceId;
	}

	public hasWritePermissions = true;

	private _ngUnsubscribe = new Subject();
	private _siteConfigObject: ArmObj<SiteConfig>;
	private _busyManager: BusyStateScopeManager;

	public showFTPDashboard = false;
	public showWebDeployDashboard = false;

	constructor(
		private _authZService: AuthzService,
		private _cacheService: CacheService,
		private _logService: LogService,
		broadcastService: BroadcastService
	) {
		this._busyManager = new BusyStateScopeManager(broadcastService, 'site-tabs');

		this.resourceIdStream = new Subject<string>();
		this.resourceIdStream
			.takeUntil(this._ngUnsubscribe)
			.distinctUntilChanged()
			.switchMap(resourceId => {
				this._busyManager.setBusy();
				this.resourceId = resourceId;
				this._siteConfigObject = null;
				return Observable.zip(
					this._cacheService.getArm(`${resourceId}/config/web`),
					this._authZService.hasPermission(resourceId, [AuthzService.writeScope]),
					this._authZService.hasReadOnlyLock(resourceId),
					(sc, wp, rl) => ({
						siteConfig: sc.json(),
						writePermission: wp,
						readOnlyLock: rl
					})
				);
			})
			.subscribe(
				r => {
					this._siteConfigObject = r.siteConfig;
					this.hasWritePermissions = r.writePermission && !r.readOnlyLock;
					this._busyManager.clearBusy();
				},
				err => {
					this._siteConfigObject = null;
					this._logService.error(LogCategories.cicd, '/load-deployment-center', err);
					this._busyManager.clearBusy();
				}
			);
		broadcastService.getEvents<string>(BroadcastEvent.ReloadDeploymentCenter).subscribe(this.refreshedSCMType.bind(this));
	}

	refreshedSCMType() {
		this._cacheService.clearArmIdCachePrefix(`${this.resourceId}/config/web`);
		this.resourceIdStream.next(this.resourceId);
	}

	get DeploymentSetUpComplete() {
		return this._siteConfigObject && this._siteConfigObject.properties.scmType !== 'None';
	}

	get ScmType() {
		return this._siteConfigObject && this._siteConfigObject.properties.scmType;
	}

	ngOnDestroy() {
		this._ngUnsubscribe.next();
	}
}
