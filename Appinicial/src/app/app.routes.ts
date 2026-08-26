import { Routes } from '@angular/router';
import { Api } from './paginas/api/api';

export const routes: Routes = [
    { path: '', component: Api, pathMatch: 'full' }
];
